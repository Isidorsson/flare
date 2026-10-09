//! Runs the `git` executable directly (no shell, nothing interpolated into a command line). Shared
//! by `checkpoints` and `vcs`. `Git::gh` runs the GitHub CLI the same way, with the same timeout and
//! environment handling.
//!
//! Every command is bounded by a timeout (`DEFAULT_TIMEOUT`, or whatever the caller sets for a slow
//! one such as a push), so it is not adopted into a `proctree::ProcessTree`: a job object exists to
//! take down long-lived trees (shells, the bridge) when Flare dies, but git protects its own data
//! with lock files and atomic renames, so a git that outlives Flare by a few seconds corrupts
//! nothing, and adopting a pid right after spawn races with commands that exit at once.

use std::ffi::{OsStr, OsString};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

mod error;

pub use error::GitError;

const GIT_PROGRAM: &str = "git";
const GH_PROGRAM: &str = "gh";
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
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

/// `gh` never prompts, never checks for a newer release and never colours its output, so a
/// command either finishes or fails with a message.
const GH_ENV: [(&str, &str); 3] = [
    ("GH_PROMPT_DISABLED", "1"),
    ("GH_NO_UPDATE_NOTIFIER", "1"),
    ("NO_COLOR", "1"),
];

pub const INDEX_FILE_ENV: &str = "GIT_INDEX_FILE";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tool {
    Git,
    Gh,
}

impl Tool {
    /// Leading arguments that name a command in errors: `push`, or `pr create`.
    fn command_words(self) -> usize {
        match self {
            Self::Git => 1,
            Self::Gh => 2,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Git {
    program: OsString,
    tool: Tool,
    cwd: PathBuf,
    global_args: Vec<OsString>,
}

impl Git {
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self::of(Tool::Git, GIT_PROGRAM, cwd.into())
    }

    /// The GitHub CLI. It runs git underneath, so it gets the same repository selector scrub and
    /// credential prompt switch as git itself.
    pub fn gh(cwd: impl Into<PathBuf>) -> Self {
        Self::of(Tool::Gh, GH_PROGRAM, cwd.into())
    }

    fn of(tool: Tool, program: &str, cwd: PathBuf) -> Self {
        Self {
            program: OsString::from(program),
            tool,
            cwd,
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
            timeout: DEFAULT_TIMEOUT,
        }
    }
}

#[derive(Debug)]
pub struct Invocation<'a> {
    git: &'a Git,
    args: Vec<OsString>,
    envs: Vec<(OsString, OsString)>,
    stdin: Option<Vec<u8>>,
    timeout: Duration,
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

    /// Replaces `DEFAULT_TIMEOUT` for commands that legitimately take longer.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Runs the command and fails unless it exits with status 0.
    pub fn run(self) -> Result<Output, GitError> {
        let output = self.run_unchecked()?;
        if output.code == 0 {
            Ok(output)
        } else {
            Err(output.into_error())
        }
    }

    /// Runs the command and returns whatever status it exited with, for callers that read it.
    pub fn run_unchecked(self) -> Result<Output, GitError> {
        let command = self.label();
        let mut child = self.spawn()?;
        let writer = spawn_writer(child.stdin.take(), self.stdin);
        let stdout = spawn_reader(child.stdout.take());
        let stderr = spawn_reader(child.stderr.take());
        let code = wait(&mut child, self.timeout, &command)?;
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

    fn label(&self) -> String {
        let words = self.git.tool.command_words();
        let leading: Vec<_> = self
            .args
            .iter()
            .take(words)
            .map(|arg| arg.to_string_lossy())
            .collect();
        leading.join(" ")
    }

    fn spawn(&self) -> Result<Child, GitError> {
        let git = self.git;
        let mut command = Command::new(&git.program);
        command.current_dir(&git.cwd);
        for name in SCRUBBED_ENV {
            command.env_remove(name);
        }
        command.env("GIT_TERMINAL_PROMPT", "0");
        match git.tool {
            Tool::Git => {
                command.env("GIT_LITERAL_PATHSPECS", "1");
                for config in CONFIG_OVERRIDES {
                    command.arg("-c").arg(config);
                }
            }
            Tool::Gh => {
                command.envs(GH_ENV);
            }
        }
        command.envs(self.envs.iter().map(|(key, value)| (key, value)));
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
                GitError::Missing(git.program.to_string_lossy().into_owned())
            }
            _ => GitError::io(Path::new(&git.program), error),
        })
    }
}

impl Output {
    /// The error for a run whose exit status the caller read and rejected. Some refusals are
    /// written to standard output (`git commit` saying there is nothing to commit, a hook), so
    /// that stands in for an empty standard error.
    pub fn into_error(self) -> GitError {
        let detail = if self.stderr.is_empty() {
            truncate(String::from_utf8_lossy(&self.stdout).trim().to_owned())
        } else {
            self.stderr
        };
        GitError::Failed {
            command: self.command,
            stderr: detail,
        }
    }

    /// Standard output as text without its trailing line break.
    pub fn text(&self) -> Result<String, GitError> {
        let text = std::str::from_utf8(&self.stdout).map_err(|error| GitError::Output {
            command: self.command.clone(),
            detail: error.to_string(),
        })?;
        Ok(text.trim_end_matches(['\r', '\n']).to_owned())
    }
}

fn wait(child: &mut Child, timeout: Duration, command: &str) -> Result<i32, GitError> {
    let deadline = Instant::now() + timeout;
    let mut pause = POLL_FIRST;
    loop {
        let waited = child
            .try_wait()
            .map_err(|error| GitError::io(Path::new(GIT_PROGRAM), error))?;
        if let Some(status) = waited {
            return Ok(status.code().unwrap_or(-1));
        }
        if Instant::now() >= deadline {
            stop(child);
            return Err(GitError::Timeout {
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

fn join_reader(handle: JoinHandle<io::Result<Vec<u8>>>) -> Result<Vec<u8>, GitError> {
    handle
        .join()
        .map_err(|_| GitError::Task("a git output reader panicked".to_owned()))?
        .map_err(|error| GitError::io(Path::new(GIT_PROGRAM), error))
}

fn join_writer(handle: JoinHandle<io::Result<()>>) -> Result<(), GitError> {
    handle
        .join()
        .map_err(|_| GitError::Task("a git input writer panicked".to_owned()))?
        .map_err(|error| GitError::io(Path::new(GIT_PROGRAM), error))
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
mod tests;
