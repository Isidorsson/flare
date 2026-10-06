//! Spawns real shells through the native pty (ConPTY on Windows).

use std::ffi::OsString;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::error::PtyError;
use super::pump::{PtyEvent, Sink};
use super::session::{spawn_session, Session, SpawnConfig};
use super::shell::ShellSpec;
use super::state::PtyState;

const TIMEOUT: Duration = Duration::from_secs(15);
const CURSOR_POSITION_QUERY: &[u8] = b"\x1b[6n";
const CURSOR_POSITION_REPLY: &[u8] = b"\x1b[1;1R";

type Reply = Box<dyn Fn(Vec<u8>)>;

fn shell(program: &str, args: &[&str]) -> ShellSpec {
    ShellSpec {
        program: OsString::from(program),
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
    }
}

fn one_shot(script: &str) -> ShellSpec {
    if cfg!(windows) {
        shell("cmd.exe", &["/c", script])
    } else {
        shell("sh", &["-c", script])
    }
}

fn interactive() -> ShellSpec {
    if cfg!(windows) {
        shell("cmd.exe", &[])
    } else {
        shell("sh", &[])
    }
}

fn config(shell: ShellSpec) -> SpawnConfig {
    SpawnConfig {
        shell,
        cwd: std::env::temp_dir(),
        cols: 100,
        rows: 30,
    }
}

fn channel_sink() -> (Sink, Receiver<PtyEvent>) {
    let (tx, rx) = mpsc::channel();
    let sink: Sink = Arc::new(move |event| tx.send(event).map_err(|error| error.to_string()));
    (sink, rx)
}

/// ConPTY asks the terminal for the cursor position on startup and holds all
/// output until it is answered, so the harness plays the terminal's part.
struct Transcript {
    events: Receiver<PtyEvent>,
    reply: Reply,
    output: Vec<u8>,
    exit: Option<Option<u32>>,
}

impl Transcript {
    fn new(events: Receiver<PtyEvent>, reply: Reply) -> Self {
        Self {
            events,
            reply,
            output: Vec::new(),
            exit: None,
        }
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.output).into_owned()
    }

    fn answer_queries(&self, chunk: &[u8]) {
        let queries = chunk
            .windows(CURSOR_POSITION_QUERY.len())
            .filter(|window| *window == CURSOR_POSITION_QUERY)
            .count();
        for _ in 0..queries {
            (self.reply)(CURSOR_POSITION_REPLY.to_vec());
        }
    }

    fn wait_until(&mut self, done: impl Fn(&Self) -> bool) -> bool {
        let deadline = Instant::now() + TIMEOUT;
        while !done(self) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self.events.recv_timeout(remaining) {
                Ok(PtyEvent::Output(bytes)) => {
                    self.answer_queries(&bytes);
                    self.output.extend(bytes);
                }
                Ok(PtyEvent::Exit { code }) => self.exit = Some(code),
                Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => return false,
            }
        }
        true
    }

    fn wait_for_text(&mut self, needle: &str) {
        assert!(
            self.wait_until(|run| run.text().contains(needle)),
            "never saw {needle:?}; output was {:?}",
            self.text()
        );
    }

    fn wait_for_exit(&mut self) -> Option<u32> {
        assert!(
            self.wait_until(|run| run.exit.is_some()),
            "no exit event; output was {:?}",
            self.text()
        );
        self.exit.flatten()
    }
}

fn reply_through_session(session: &Arc<Session>) -> Reply {
    let session = Arc::clone(session);
    Box::new(move |bytes| {
        // Replies race the shell exiting; a closed session just means no reply is needed.
        session.write(bytes).ok();
    })
}

fn reply_through_state(state: &Arc<PtyState>, id: &'static str) -> Reply {
    let state = Arc::clone(state);
    Box::new(move |bytes| {
        state.write(id, bytes).ok();
    })
}

fn start(shell: ShellSpec) -> (Arc<Session>, Transcript) {
    let (sink, events) = channel_sink();
    let session = Arc::new(spawn_session("t1", &config(shell), sink).expect("spawn session"));
    let run = Transcript::new(events, reply_through_session(&session));
    (session, run)
}

#[test]
fn one_shot_command_streams_its_output_and_exits_with_zero() {
    let (_session, mut run) = start(one_shot("echo flare-pty-ok"));

    run.wait_for_text("flare-pty-ok");

    assert_eq!(run.wait_for_exit(), Some(0));
}

#[test]
fn a_nonzero_exit_code_is_reported() {
    let (_session, mut run) = start(one_shot("exit 7"));

    assert_eq!(run.wait_for_exit(), Some(7));
}

#[test]
fn typed_input_reaches_the_shell_and_exit_code_comes_back() {
    let (session, mut run) = start(interactive());

    session
        .write(b"echo flare-input-ok\r".to_vec())
        .expect("write input");
    run.wait_for_text("flare-input-ok");
    session.write(b"exit 3\r".to_vec()).expect("write exit");

    assert_eq!(run.wait_for_exit(), Some(3));
    assert!(session.wait_finished(TIMEOUT));
}

#[cfg(windows)]
#[test]
fn the_default_windows_shell_starts_and_reports_its_exit_code() {
    use super::shell::{default_shell, is_executable_candidate, ShellEnv};

    let spec = default_shell(&ShellEnv::current(), is_executable_candidate);
    let (session, mut run) = start(spec);

    session.write(b"exit 5\r".to_vec()).expect("write exit");

    assert_eq!(run.wait_for_exit(), Some(5));
}

#[test]
fn kill_terminates_a_running_shell_and_reports_the_exit() {
    let (session, mut run) = start(interactive());

    session.kill().expect("kill shell");

    assert!(run.wait_for_exit().is_some());
    assert!(session.wait_finished(TIMEOUT));
    session.kill().expect("killing an exited shell is a no-op");
}

#[test]
fn resize_works_while_running_and_fails_after_exit() {
    let (session, mut run) = start(interactive());

    session.resize(120, 40).expect("resize running shell");
    session.kill().expect("kill shell");
    run.wait_for_exit();
    assert!(session.wait_finished(TIMEOUT));

    assert!(matches!(session.resize(80, 24), Err(PtyError::Exited(_))));
    assert!(matches!(
        session.write(b"x".to_vec()),
        Err(PtyError::Exited(_))
    ));
}

#[test]
fn state_tracks_sessions_by_id_and_shuts_everything_down() {
    let state = Arc::new(PtyState::default());
    let (sink_a, events_a) = channel_sink();
    let (sink_b, events_b) = channel_sink();

    state
        .spawn("a", &config(interactive()), sink_a)
        .expect("spawn a");
    state
        .spawn("b", &config(interactive()), sink_b)
        .expect("spawn b");
    let mut run_a = Transcript::new(events_a, reply_through_state(&state, "a"));
    let mut run_b = Transcript::new(events_b, reply_through_state(&state, "b"));
    let (duplicate_sink, _events) = channel_sink();
    let duplicate = state.spawn("a", &config(interactive()), duplicate_sink);
    assert!(matches!(duplicate, Err(PtyError::Duplicate(_))));
    state.resize("a", 90, 20).expect("resize a");

    state.shutdown_all();

    assert!(run_a.wait_for_exit().is_some());
    assert!(run_b.wait_for_exit().is_some());
    assert!(matches!(
        state.write("a", Vec::new()),
        Err(PtyError::NotFound(_))
    ));
}

#[test]
fn kill_removes_the_session_and_unknown_ids_are_reported() {
    let state = Arc::new(PtyState::default());
    let (sink, events) = channel_sink();
    state
        .spawn("a", &config(interactive()), sink)
        .expect("spawn");
    let mut run = Transcript::new(events, reply_through_state(&state, "a"));

    state.kill("a").expect("kill");

    assert!(run.wait_for_exit().is_some());
    assert!(matches!(state.kill("a"), Err(PtyError::NotFound(_))));
}
