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

    pub fn kill(&self, id: &str) -> Result<(), PtyError> {
        let session = lock(&self.sessions).remove(id)?;
        session.kill()
    }

    pub fn kill_all(&self) -> Vec<Arc<Session>> {
        let sessions = lock(&self.sessions).drain();
        for session in &sessions {
            if let Err(error) = session.kill() {
                eprintln!("flare pty: {error}");
            }
        }
        sessions
    }

    pub fn shutdown_all(&self) {
        for session in &self.kill_all() {
            if !session.wait_finished(SHUTDOWN_TIMEOUT) {
                eprintln!("flare pty: a terminal did not stop within {SHUTDOWN_TIMEOUT:?}");
            }
        }
    }

    fn session(&self, id: &str) -> Result<Arc<Session>, PtyError> {
        lock(&self.sessions).get(id)
    }
}
