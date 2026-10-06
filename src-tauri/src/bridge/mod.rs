mod framing;

use std::fmt;
use std::sync::{Mutex, MutexGuard};

use serde::{Serialize, Serializer};
use tauri::async_runtime::Receiver;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use framing::{frame_outgoing, FramingError, LineFramer, OutgoingError};

const SIDECAR_NAME: &str = "flare-bridge";

#[derive(Debug)]
pub enum BridgeError {
    Spawn(String),
    NotRunning,
    Write(String),
    InvalidLine(OutgoingError),
    Poisoned,
}

impl fmt::Display for BridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spawn(reason) => write!(f, "could not start the agent bridge: {reason}"),
            Self::NotRunning => write!(f, "the agent bridge is not running"),
            Self::Write(reason) => write!(f, "could not write to the agent bridge: {reason}"),
            Self::InvalidLine(reason) => write!(f, "{reason}"),
            Self::Poisoned => write!(
                f,
                "the agent bridge state is unusable after an earlier panic"
            ),
        }
    }
}

impl Serialize for BridgeError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

struct Running {
    pid: u32,
    child: CommandChild,
}

#[derive(Default)]
pub struct BridgeState {
    running: Mutex<Option<Running>>,
}

impl BridgeState {
    fn lock(&self) -> Result<MutexGuard<'_, Option<Running>>, BridgeError> {
        self.running.lock().map_err(|_| BridgeError::Poisoned)
    }

    fn replace(&self, next: Running) -> Result<(), BridgeError> {
        let previous = self.lock()?.replace(next);
        kill_quietly(previous);
        Ok(())
    }

    fn write(&self, bytes: &[u8]) -> Result<(), BridgeError> {
        let mut guard = self.lock()?;
        let running = guard.as_mut().ok_or(BridgeError::NotRunning)?;
        running
            .child
            .write(bytes)
            .map_err(|error| BridgeError::Write(error.to_string()))
    }

    fn take_if_pid(&self, pid: u32) -> Option<Running> {
        let mut guard = self.lock().ok()?;
        match guard.as_ref() {
            Some(running) if running.pid == pid => guard.take(),
            _ => None,
        }
    }

    pub fn kill(&self) {
        if let Ok(mut guard) = self.lock() {
            kill_quietly(guard.take());
        }
    }
}

fn kill_quietly(running: Option<Running>) {
    if let Some(Running { pid, child }) = running {
        if let Err(error) = child.kill() {
            eprintln!("flare: could not stop agent bridge {pid}: {error}");
        }
    }
}

#[tauri::command]
pub fn bridge_start(
    app: AppHandle,
    state: State<'_, BridgeState>,
    on_event: Channel<String>,
) -> Result<(), BridgeError> {
    let (events, child) = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .and_then(|command| command.set_raw_out(true).spawn())
        .map_err(|error| BridgeError::Spawn(error.to_string()))?;
    let pid = child.pid();
    state.replace(Running { pid, child })?;
    tauri::async_runtime::spawn(relay(app, events, on_event, pid));
    Ok(())
}

#[tauri::command]
pub async fn bridge_send(state: State<'_, BridgeState>, line: String) -> Result<(), BridgeError> {
    let framed = frame_outgoing(&line).map_err(BridgeError::InvalidLine)?;
    state.write(&framed)
}

async fn relay(
    app: AppHandle,
    mut events: Receiver<CommandEvent>,
    channel: Channel<String>,
    pid: u32,
) {
    let mut framer = LineFramer::default();
    while let Some(event) = events.recv().await {
        let delivered = match event {
            CommandEvent::Stdout(bytes) => forward(&channel, framer.push(&bytes)),
            CommandEvent::Stderr(bytes) => {
                eprint!("[flare-bridge] {}", String::from_utf8_lossy(&bytes));
                true
            }
            CommandEvent::Error(reason) => send(
                &channel,
                error_line(&format!("agent bridge process error: {reason}"), false),
            ),
            CommandEvent::Terminated(payload) => {
                forward(&channel, framer.finish().into_iter().collect());
                let reason = match payload.code {
                    Some(code) => format!("the agent bridge exited with code {code}"),
                    None => "the agent bridge was terminated".to_owned(),
                };
                send(&channel, error_line(&reason, true));
                break;
            }
            _ => true,
        };
        if !delivered {
            eprintln!("flare: the window stopped listening to the agent bridge, stopping it");
            break;
        }
    }
    kill_quietly(app.state::<BridgeState>().take_if_pid(pid));
}

fn forward(channel: &Channel<String>, lines: Vec<Result<String, FramingError>>) -> bool {
    lines.into_iter().all(|line| {
        let line = line.unwrap_or_else(|error| error_line(&error.to_string(), false));
        send(channel, line)
    })
}

fn send(channel: &Channel<String>, line: String) -> bool {
    match channel.send(line) {
        Ok(()) => true,
        Err(error) => {
            eprintln!("flare: could not deliver an agent bridge event: {error}");
            false
        }
    }
}

fn error_line(message: &str, fatal: bool) -> String {
    serde_json::json!({ "type": "error", "message": message, "fatal": fatal }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_lines_are_valid_protocol_errors() {
        let line = error_line("the bridge \"died\"\nbadly", true);
        let value: serde_json::Value = serde_json::from_str(&line).expect("valid json");
        assert_eq!(value["type"], "error");
        assert_eq!(value["message"], "the bridge \"died\"\nbadly");
        assert_eq!(value["fatal"], true);
        assert!(
            !line.contains('\n'),
            "an NDJSON line must not contain a raw newline"
        );
    }

    #[test]
    fn framing_errors_are_reported_as_non_fatal_error_events() {
        let mut framer = LineFramer::default();
        let delivered: Vec<String> = framer
            .push(b"\xff\n")
            .into_iter()
            .map(|line| line.unwrap_or_else(|error| error_line(&error.to_string(), false)))
            .collect();
        let value: serde_json::Value = serde_json::from_str(&delivered[0]).expect("valid json");
        assert_eq!(value["fatal"], false);
    }

    #[test]
    fn bridge_errors_serialize_as_plain_messages() {
        let json = serde_json::to_string(&BridgeError::NotRunning).expect("serializes");
        assert_eq!(json, "\"the agent bridge is not running\"");
    }

    #[test]
    fn state_without_a_bridge_refuses_writes() {
        let state = BridgeState::default();
        assert!(matches!(state.write(b"x\n"), Err(BridgeError::NotRunning)));
    }
}
