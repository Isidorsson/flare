//! Runs the `git` executable directly (no shell, nothing interpolated into a command line).
//!
//! Every command is short-lived and bounded by a timeout, so it is not adopted into a
//! `proctree::ProcessTree`: a job object exists to take down long-lived trees (shells, the bridge)
//! when Flare dies, but git only writes immutable objects and files in a scratch index, so a git
//! that outlives Flare by a few seconds corrupts nothing, and adopting a pid right after spawn
//! races with commands that exit at once.

use std::ffi::{OsStr, OsString};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::error::CheckpointError;

const GIT_PROGRAM: &str = "git";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
const POLL_FIRST: Duration = Duration::from_millis(1);
const POLL_MAX: Duration = Duration::from_millis(20);
const STDERR_LIMIT: usize = 2_000;

/// Repository selectors from the parent environment would redirect a command to the wrong repo.
const SCRUBBED_ENV: [&str; 8] = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_PREFIX",
    "GIT_NAMESPACE",
];

/// A monitor daemon would be started against a scratch index, long paths must work on Windows, and
/// no command here may trigger maintenance in the user's repository.
const CONFIG_OVERRIDES: [&str; 4] = [
    "core.fsmonitor=false",
    "core.longpaths=true",
    "core.quotepath=off",
    "gc.auto=0",
];

pub const INDEX_FILE_ENV: &str = "GIT_INDEX_FILE";

#[derive(Debug, Clone)]
pub struct Git {
    program: OsString,
    cwd: PathBuf,
    global_args: Vec<OsString>,
}

impl Git {
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self {
            program: OsString::from(GIT_PROGRAM),
            cwd: cwd.into(),
            global_args: Vec::new(),
        }
    }

    pub fn with_global_args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        self.global_args = args.into_iter().map(Into::into).collect();
        self
    }

    #[cfg(test)]
    pub fn with_program(mut self, program: impl Into<OsString>) -> Self {
        self.program = program.into();
        self
    }

    pub fn command<I, S>(&self, args: I) -> Invocation<'_>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        Invocation {
            git: self,
            args: args
                .into_iter()
                .map(|arg| arg.as_ref().to_owned())
                .collect(),
            envs: Vec::new(),
            stdin: None,
        }
    }
}

#[derive(Debug)]
pub struct Invocation<'a> {
    git: &'a Git,
    args: Vec<OsString>,
    envs: Vec<(OsString, OsString)>,
    stdin: Option<Vec<u8>>,
}

#[derive(Debug)]
pub struct Output {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: String,
    command: String,
}

impl Invocation<'_> {
    pub fn env(mut self, key: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.envs.push((key.into(), value.into()));
        self
    }

    pub fn stdin(mut self, bytes: Vec<u8>) -> Self {
        self.stdin = Some(bytes);
        self
    }

    /// Runs the command and fails unless it exits with status 0.
    pub fn run(self) -> Result<Output, CheckpointError> {
        let output = self.run_unchecked()?;
        if output.code == 0 {
            Ok(output)
        } else {
            Err(output.into_error())
        }
    }

    /// Runs the command and returns whatever status it exited with, for callers that read it.
    pub fn run_unchecked(self) -> Result<Output, CheckpointError> {
        let command = self
            .args
            .first()
            .map(|arg| arg.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut child = self.spawn()?;
        let writer = spawn_writer(child.stdin.take(), self.stdin);
        let stdout = spawn_reader(child.stdout.take());
        let stderr = spawn_reader(child.stderr.take());
        let code = wait(&mut child, COMMAND_TIMEOUT, &command)?;
        join_writer(writer)?;
        let stderr = String::from_utf8_lossy(&join_reader(stderr)?)
            .trim()
            .to_owned();
        Ok(Output {
            code,
            stdout: join_reader(stdout)?,
            stderr: truncate(stderr),
            command,
        })
    }

    fn spawn(&self) -> Result<Child, CheckpointError> {
        let git = self.git;
        let mut command = Command::new(&git.program);
        command.current_dir(&git.cwd);
        for name in SCRUBBED_ENV {
            command.env_remove(name);
        }
        command
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_LITERAL_PATHSPECS", "1")
            .envs(self.envs.iter().map(|(key, value)| (key, value)));
        for config in CONFIG_OVERRIDES {
            command.arg("-c").arg(config);
        }
        command.args(&git.global_args).args(&self.args);
        command
            .stdin(if self.stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console_window(&mut command);
        command.spawn().map_err(|error| match error.kind() {
            io::ErrorKind::NotFound => {
                CheckpointError::GitMissing(git.program.to_string_lossy().into_owned())
            }
            _ => CheckpointError::io(Path::new(&git.program), error),
        })
    }
}

impl Output {
    /// The error for a run whose exit status the caller read and rejected.
    pub fn into_error(self) -> CheckpointError {
        CheckpointError::Git {
            command: self.command,
            stderr: self.stderr,
        }
    }

    /// Standard output as text without its trailing line break.
    pub fn text(&self) -> Result<String, CheckpointError> {
        let text = std::str::from_utf8(&self.stdout).map_err(|error| CheckpointError::Output {
            command: self.command.clone(),
            detail: error.to_string(),
        })?;
        Ok(text.trim_end_matches(['\r', '\n']).to_owned())
    }
}

fn wait(child: &mut Child, timeout: Duration, command: &str) -> Result<i32, CheckpointError> {
    let deadline = Instant::now() + timeout;
    let mut pause = POLL_FIRST;
    loop {
        let waited = child
            .try_wait()
            .map_err(|error| CheckpointError::io(Path::new(GIT_PROGRAM), error))?;
        if let Some(status) = waited {
            return Ok(status.code().unwrap_or(-1));
        }
        if Instant::now() >= deadline {
            stop(child);
            return Err(CheckpointError::Timeout {
                command: command.to_owned(),
                seconds: timeout.as_secs(),
            });
        }
        thread::sleep(pause);
        pause = (pause * 2).min(POLL_MAX);
    }
}

fn stop(child: &mut Child) {
    if let Err(error) = child.kill() {
        eprintln!("flare: could not stop a timed out git process: {error}");
    }
    if let Err(error) = child.wait() {
        eprintln!("flare: could not reap a timed out git process: {error}");
    }
}

fn spawn_reader<R: Read + Send + 'static>(pipe: Option<R>) -> JoinHandle<io::Result<Vec<u8>>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            pipe.read_to_end(&mut bytes)?;
        }
        Ok(bytes)
    })
}

/// Git may exit (with its own error) before reading all of its input; that is not a write failure.
fn spawn_writer(pipe: Option<ChildStdin>, input: Option<Vec<u8>>) -> JoinHandle<io::Result<()>> {
    thread::spawn(move || {
        let (Some(mut pipe), Some(bytes)) = (pipe, input) else {
            return Ok(());
        };
        match pipe.write_all(&bytes) {
            Err(error) if error.kind() == io::ErrorKind::BrokenPipe => Ok(()),
            other => other,
        }
    })
}

fn join_reader(handle: JoinHandle<io::Result<Vec<u8>>>) -> Result<Vec<u8>, CheckpointError> {
    handle
        .join()
        .map_err(|_| CheckpointError::Task("a git output reader panicked".to_owned()))?
        .map_err(|error| CheckpointError::io(Path::new(GIT_PROGRAM), error))
}

fn join_writer(handle: JoinHandle<io::Result<()>>) -> Result<(), CheckpointError> {
    handle
        .join()
        .map_err(|_| CheckpointError::Task("a git input writer panicked".to_owned()))?
        .map_err(|error| CheckpointError::io(Path::new(GIT_PROGRAM), error))
}

fn truncate(mut text: String) -> String {
    if text.len() > STDERR_LIMIT {
        let mut end = STDERR_LIMIT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push('…');
    }
    text
}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn here() -> Git {
        Git::new(std::env::temp_dir())
    }

    #[test]
    fn captures_output_and_trims_the_line_break() {
        let version = here().command(["--version"]).run().expect("git runs");
        assert!(version.text().expect("utf8").starts_with("git version"));
    }

    #[test]
    fn a_failing_command_reports_its_name_and_stderr() {
        let error = here()
            .command(["rev-parse", "--verify", "no-such-rev"])
            .run()
            .expect_err("fails");
        assert_eq!(error.code(), "git");
        assert!(error.to_string().starts_with("git rev-parse failed:"));
    }

    #[test]
    fn unchecked_runs_return_the_exit_code() {
        let output = here()
            .command(["rev-parse", "--verify", "no-such-rev"])
            .run_unchecked()
            .expect("runs");
        assert_ne!(output.code, 0);
    }

    #[test]
    fn a_missing_executable_is_reported_as_git_missing() {
        let error = here()
            .with_program("flare-definitely-not-git")
            .command(["--version"])
            .run()
            .expect_err("no such program");
        assert_eq!(error.code(), "git_missing");
    }

    #[test]
    fn input_reaches_the_process() {
        let output = here()
            .command(["hash-object", "--stdin"])
            .stdin(b"hello\n".to_vec())
            .run()
            .expect("hashes");
        assert_eq!(
            output.text().expect("utf8"),
            "ce013625030ba8dba906f756967f9e9ca394464a"
        );
    }

    #[test]
    fn large_input_is_streamed_while_output_is_collected() {
        let blob = vec![b'x'; 4 * 1024 * 1024];
        let hashed = here()
            .command(["hash-object", "--stdin"])
            .stdin(blob)
            .run()
            .expect("hashes");
        assert_eq!(hashed.text().expect("utf8").len(), 40);
    }

    #[test]
    fn a_process_that_stops_reading_input_is_not_a_write_error() {
        let output = here()
            .command(["rev-parse", "--verify", "no-such-rev"])
            .stdin(vec![b'x'; 4 * 1024 * 1024])
            .run_unchecked()
            .expect("the failure comes from git, not from the pipe");
        assert_ne!(output.code, 0);
    }

    #[test]
    fn a_process_that_overruns_its_timeout_is_killed() {
        let mut sleeper = if cfg!(windows) {
            let mut command = Command::new("ping");
            command.args(["-n", "30", "127.0.0.1"]);
            command
        } else {
            let mut command = Command::new("sleep");
            command.arg("30");
            command
        }
        .stdout(Stdio::null())
        .spawn()
        .expect("spawn a sleeper");
        let error = wait(&mut sleeper, Duration::from_millis(50), "sleep").expect_err("times out");
        assert_eq!(error.code(), "timeout");
        assert!(
            sleeper.try_wait().expect("status").is_some(),
            "the process was reaped"
        );
    }

    #[test]
    fn truncation_respects_character_boundaries() {
        let long = "é".repeat(STDERR_LIMIT);
        let cut = truncate(long);
        assert!(cut.ends_with('…'));
        assert!(cut.len() <= STDERR_LIMIT + '…'.len_utf8());
    }
}
