use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::error::PtyError;
use super::pump::Sink;
use super::registry::SessionRegistry;
use super::session::{lock, spawn_session, Session, SpawnConfig};

pub const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<SessionRegistry<Session>>,
}

/// Every session a bulk close removed, and the ones that could not be stopped.
pub struct Closed {
    sessions: Vec<Arc<Session>>,
    failures: Vec<PtyError>,
}

impl Closed {
    pub fn count(&self) -> usize {
        self.sessions.len()
    }

    #[cfg(test)]
    pub fn sessions(&self) -> &[Arc<Session>] {
        &self.sessions
    }

    /// Fails when any session could not be stopped, so the caller hears about it.
    pub fn into_count(self) -> Result<usize, PtyError> {
        let count = self.count();
        if self.failures.is_empty() {
            return Ok(count);
        }
        let reasons: Vec<String> = self.failures.iter().map(ToString::to_string).collect();
        Err(PtyError::backend(
            "close every terminal",
            format!(
                "{} of {count} failed: {}",
                reasons.len(),
                reasons.join("; ")
            ),
        ))
    }
}

impl PtyState {
    pub fn spawn(&self, id: &str, config: &SpawnConfig, sink: Sink) -> Result<(), PtyError> {
        if lock(&self.sessions).contains(id) {
            return Err(PtyError::Duplicate(id.to_owned()));
        }
        let session = Arc::new(spawn_session(id, config, sink)?);
        lock(&self.sessions)
            .insert(id.to_owned(), Arc::clone(&session))
            .inspect_err(|_| {
                if let Err(error) = session.kill() {
                    eprintln!("flare pty: {error}");
                }
            })
    }

    pub fn write(&self, id: &str, data: Vec<u8>) -> Result<(), PtyError> {
        self.session(id)?.write(data)
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        self.session(id)?.resize(cols, rows)
    }

    /// Closing is idempotent: `false` means there was no such session, which
    /// is what a tab closed twice, or after a close-all, looks like.
    pub fn kill(&self, id: &str) -> Result<bool, PtyError> {
        let removed = lock(&self.sessions).remove(id);
        match removed {
            Ok(session) => session.kill().map(|()| true),
            Err(PtyError::NotFound(_)) => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub fn kill_all(&self) -> Closed {
        let sessions = lock(&self.sessions).drain();
        let failures = sessions
            .iter()
            .filter_map(|session| session.kill().err())
            .collect();
        Closed { sessions, failures }
    }

    pub fn shutdown_all(&self) {
        let closed = self.kill_all();
        for failure in &closed.failures {
            eprintln!("flare pty: {failure}");
        }
        for session in &closed.sessions {
            if !session.wait_finished(SHUTDOWN_TIMEOUT) {
                eprintln!("flare pty: a terminal did not stop within {SHUTDOWN_TIMEOUT:?}");
            }
        }
    }

    #[cfg(all(test, windows))]
    pub fn member_pids(&self, id: &str) -> Result<Vec<u32>, PtyError> {
        self.session(id)?.member_pids()
    }

    fn session(&self, id: &str) -> Result<Arc<Session>, PtyError> {
        lock(&self.sessions).get(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_nothing_succeeds_with_a_count_of_zero() {
        let closed = PtyState::default().kill_all();

        assert_eq!(closed.count(), 0);
        assert_eq!(closed.into_count().expect("nothing failed"), 0);
    }

    #[test]
    fn a_failed_stop_is_reported_instead_of_hidden_in_the_count() {
        let closed = Closed {
            sessions: Vec::new(),
            failures: vec![
                PtyError::backend("stop shell", "access denied"),
                PtyError::backend("stop console host", "gone"),
            ],
        };

        let error = closed.into_count().expect_err("failures must surface");

        assert_eq!(
            error.to_string(),
            "failed to close every terminal: 2 of 0 failed: failed to stop shell: access denied; \
             failed to stop console host: gone"
        );
    }

    #[test]
    fn closing_an_unknown_session_is_not_an_error() {
        assert!(!PtyState::default().kill("nope").expect("idempotent close"));
    }
}
