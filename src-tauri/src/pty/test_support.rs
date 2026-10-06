//! Shared harness for the tests that spawn real shells through the native pty
//! (ConPTY on Windows). Every session is held by a guard that kills it and checks
//! for survivors when the test ends, however it ends.

use std::ffi::OsString;
use std::ops::Deref;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::pump::{PtyEvent, Sink};
use super::session::{spawn_session, Session, SpawnConfig};
use super::shell::ShellSpec;
use super::state::PtyState;

pub const TIMEOUT: Duration = Duration::from_secs(15);
const POLL: Duration = Duration::from_millis(25);
const CURSOR_POSITION_QUERY: &[u8] = b"\x1b[6n";
const CURSOR_POSITION_REPLY: &[u8] = b"\x1b[1;1R";

type Reply = Box<dyn Fn(Vec<u8>)>;

pub fn shell(program: &str, args: &[&str]) -> ShellSpec {
    ShellSpec {
        program: OsString::from(program),
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
    }
}

pub fn one_shot(script: &str) -> ShellSpec {
    if cfg!(windows) {
        shell("cmd.exe", &["/c", script])
    } else {
        shell("sh", &["-c", script])
    }
}

pub fn interactive() -> ShellSpec {
    if cfg!(windows) {
        shell("cmd.exe", &[])
    } else {
        shell("sh", &[])
    }
}

pub fn config(shell: ShellSpec) -> SpawnConfig {
    SpawnConfig {
        shell,
        cwd: std::env::temp_dir(),
        cols: 100,
        rows: 30,
    }
}

pub fn channel_sink() -> (Sink, Receiver<PtyEvent>) {
    let (tx, rx) = mpsc::channel();
    let sink: Sink = Arc::new(move |event| tx.send(event).map_err(|error| error.to_string()));
    (sink, rx)
}

/// ConPTY asks the terminal for the cursor position on startup and holds all
/// output until it is answered, so the harness plays the terminal's part.
pub struct Transcript {
    events: Receiver<PtyEvent>,
    reply: Reply,
    output: Vec<u8>,
    exit: Option<Option<u32>>,
}

impl Transcript {
    pub fn new(events: Receiver<PtyEvent>, reply: Reply) -> Self {
        Self {
            events,
            reply,
            output: Vec::new(),
            exit: None,
        }
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.output).into_owned()
    }

    pub fn exited(&self) -> bool {
        self.exit.is_some()
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

    /// Re-checks `done` at least every few milliseconds, so it may watch
    /// something other than the event stream.
    pub fn wait_until(&mut self, mut done: impl FnMut(&Self) -> bool) -> bool {
        let deadline = Instant::now() + TIMEOUT;
        while !done(self) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            match self.events.recv_timeout(remaining.min(POLL)) {
                Ok(PtyEvent::Output(bytes)) => {
                    self.answer_queries(&bytes);
                    self.output.extend(bytes);
                }
                Ok(PtyEvent::Exit { code }) => self.exit = Some(code),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return done(self),
            }
        }
        true
    }

    pub fn wait_for_text(&mut self, needle: &str) {
        assert!(
            self.wait_until(|run| run.text().contains(needle)),
            "never saw {needle:?}; output was {:?}",
            self.text()
        );
    }

    pub fn wait_for_exit(&mut self) -> Option<u32> {
        assert!(
            self.wait_until(Self::exited),
            "no exit event; output was {:?}",
            self.text()
        );
        self.exit.flatten()
    }
}

pub fn reply_through_session(session: &Arc<Session>) -> Reply {
    let session = Arc::clone(session);
    Box::new(move |bytes| {
        // Replies race the shell exiting; a closed session just means no reply is needed.
        session.write(bytes).ok();
    })
}

pub fn reply_through_state(state: &Arc<PtyState>, id: &'static str) -> Reply {
    let state = Arc::clone(state);
    Box::new(move |bytes| {
        state.write(id, bytes).ok();
    })
}

/// A session that is killed, awaited and checked for survivors on drop.
pub struct Lease {
    session: Arc<Session>,
}

impl Deref for Lease {
    type Target = Session;

    fn deref(&self) -> &Session {
        &self.session
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        finish(&self.session);
    }
}

/// Owns a `PtyState` for a test and closes every session left in it on drop.
pub struct StateLease(pub Arc<PtyState>);

impl Drop for StateLease {
    fn drop(&mut self) {
        for session in self.0.kill_all().sessions() {
            finish(session);
        }
    }
}

fn finish(session: &Session) {
    if let Err(problem) = settle(session) {
        assert!(thread::panicking(), "{problem}");
        eprintln!("flare test: {problem}");
    }
}

fn settle(session: &Session) -> Result<(), String> {
    session
        .kill()
        .map_err(|error| format!("could not stop the shell: {error}"))?;
    if !session.wait_finished(TIMEOUT) {
        return Err(format!("the shell had not finished after {TIMEOUT:?}"));
    }
    survivors(session)
}

#[cfg(windows)]
fn survivors(session: &Session) -> Result<(), String> {
    let deadline = Instant::now() + TIMEOUT;
    loop {
        let mut pids = session.member_pids().map_err(|error| error.to_string())?;
        pids.extend(session.host_pids().map_err(|error| error.to_string())?);
        if pids.is_empty() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("processes {pids:?} survived their session"));
        }
        thread::sleep(POLL);
    }
}

#[cfg(not(windows))]
fn survivors(_session: &Session) -> Result<(), String> {
    Ok(())
}

pub fn start(shell: ShellSpec) -> (Lease, Transcript) {
    let (sink, events) = channel_sink();
    let session = Arc::new(spawn_session("t1", &config(shell), sink).expect("spawn session"));
    let run = Transcript::new(events, reply_through_session(&session));
    (Lease { session }, run)
}
