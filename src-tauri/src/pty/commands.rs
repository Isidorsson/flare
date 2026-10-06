use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use super::error::PtyError;
use super::pump::{PtyEvent, Sink};
use super::session::SpawnConfig;
use super::shell::{default_shell, home_dir, is_executable_candidate, ShellEnv, ShellSpec};
use super::state::PtyState;

const MAX_ID_LEN: usize = 128;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnRequest {
    pub id: String,
    pub cwd: Option<String>,
    pub shell: Option<ShellOverride>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOverride {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Control {
    Exit { code: Option<u32> },
}

/// Output is sent as a raw binary frame (an ArrayBuffer in JS); lifecycle
/// events are JSON objects, so the frontend can tell them apart by shape.
pub fn event_body(event: PtyEvent) -> Result<InvokeResponseBody, PtyError> {
    match event {
        PtyEvent::Output(bytes) => Ok(InvokeResponseBody::Raw(bytes)),
        PtyEvent::Exit { code } => serde_json::to_string(&Control::Exit { code })
            .map(InvokeResponseBody::Json)
            .map_err(|error| PtyError::backend("encode exit event", error)),
    }
}

fn channel_sink(channel: Channel<InvokeResponseBody>) -> Sink {
    Arc::new(move |event| {
        let body = event_body(event).map_err(|error| error.to_string())?;
        channel.send(body).map_err(|error| error.to_string())
    })
}

pub fn validate_id(id: &str) -> Result<(), PtyError> {
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return Err(PtyError::InvalidRequest(format!(
            "session id must be 1 to {MAX_ID_LEN} characters"
        )));
    }
    Ok(())
}

pub fn validate_size(cols: u16, rows: u16) -> Result<(), PtyError> {
    if cols == 0 || rows == 0 {
        return Err(PtyError::InvalidRequest(format!(
            "terminal size must be positive, got {cols}x{rows}"
        )));
    }
    Ok(())
}

pub fn resolve_cwd(
    requested: Option<&str>,
    home: Option<PathBuf>,
    is_dir: impl Fn(&Path) -> bool,
) -> Result<PathBuf, PtyError> {
    let Some(requested) = requested.filter(|path| !path.is_empty()) else {
        return home.ok_or_else(|| {
            PtyError::InvalidRequest("no working directory and no home directory".into())
        });
    };
    let path = PathBuf::from(requested);
    if !is_dir(&path) {
        return Err(PtyError::InvalidRequest(format!(
            "working directory {requested} is not a directory"
        )));
    }
    Ok(path)
}

pub fn resolve_shell(requested: Option<&ShellOverride>, env: &ShellEnv) -> ShellSpec {
    match requested {
        Some(custom) => ShellSpec {
            program: custom.program.clone().into(),
            args: custom.args.clone(),
        },
        None => default_shell(env, is_executable_candidate),
    }
}

pub fn config_from_request(request: &SpawnRequest) -> Result<SpawnConfig, PtyError> {
    validate_id(&request.id)?;
    validate_size(request.cols, request.rows)?;
    Ok(SpawnConfig {
        shell: resolve_shell(request.shell.as_ref(), &ShellEnv::current()),
        cwd: resolve_cwd(request.cwd.as_deref(), home_dir(), Path::is_dir)?,
        cols: request.cols,
        rows: request.rows,
    })
}

#[tauri::command(async)]
pub fn pty_spawn(
    state: State<'_, PtyState>,
    request: SpawnRequest,
    on_event: Channel<InvokeResponseBody>,
) -> Result<(), PtyError> {
    let config = config_from_request(&request)?;
    state.spawn(&request.id, &config, channel_sink(on_event))
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> Result<(), PtyError> {
    state.write(&id, data.into_bytes())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), PtyError> {
    validate_size(cols, rows)?;
    state.resize(&id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: String) -> Result<(), PtyError> {
    state.kill(&id).map(drop)
}

/// Returns how many terminals were closed.
#[tauri::command]
pub fn pty_kill_all(state: State<'_, PtyState>) -> Result<usize, PtyError> {
    state.kill_all().into_count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(json: &str) -> SpawnRequest {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn parses_a_camel_case_spawn_request() {
        let parsed =
            request(r#"{"id":"t1","cwd":"C:/code","cols":120,"rows":30,"shell":{"program":"nu"}}"#);

        assert_eq!(parsed.id, "t1");
        assert_eq!(parsed.cwd.as_deref(), Some("C:/code"));
        assert_eq!((parsed.cols, parsed.rows), (120, 30));
        let shell = parsed.shell.unwrap();
        assert_eq!(shell.program, "nu");
        assert!(shell.args.is_empty());
    }

    #[test]
    fn rejects_a_spawn_request_without_a_size() {
        assert!(serde_json::from_str::<SpawnRequest>(r#"{"id":"t1","cwd":null}"#).is_err());
    }

    #[test]
    fn validates_ids_and_sizes() {
        assert!(validate_id("tab-1").is_ok());
        assert!(validate_id("").is_err());
        assert!(validate_id(&"x".repeat(MAX_ID_LEN + 1)).is_err());
        assert!(validate_size(80, 24).is_ok());
        assert!(validate_size(0, 24).is_err());
        assert!(validate_size(80, 0).is_err());
    }

    #[test]
    fn cwd_uses_the_requested_directory_when_it_exists() {
        let cwd = resolve_cwd(Some("C:/code"), None, |_| true).unwrap();
        assert_eq!(cwd, PathBuf::from("C:/code"));
    }

    #[test]
    fn cwd_rejects_a_missing_directory() {
        let error = resolve_cwd(Some("C:/nope"), Some("C:/home".into()), |_| false).unwrap_err();
        assert!(matches!(error, PtyError::InvalidRequest(message) if message.contains("C:/nope")));
    }

    #[test]
    fn cwd_falls_back_to_home_when_unset_or_empty() {
        let home = Some(PathBuf::from("C:/Users/me"));
        assert_eq!(
            resolve_cwd(None, home.clone(), |_| false).unwrap(),
            PathBuf::from("C:/Users/me")
        );
        assert_eq!(
            resolve_cwd(Some(""), home, |_| false).unwrap(),
            PathBuf::from("C:/Users/me")
        );
    }

    #[test]
    fn cwd_fails_without_a_request_or_home() {
        assert!(resolve_cwd(None, None, |_| true).is_err());
    }

    #[test]
    fn shell_override_wins_over_the_default() {
        let custom = ShellOverride {
            program: "nu.exe".into(),
            args: vec!["--login".into()],
        };

        let spec = resolve_shell(Some(&custom), &ShellEnv::current());

        assert_eq!(spec.program, std::ffi::OsString::from("nu.exe"));
        assert_eq!(spec.args, vec!["--login".to_owned()]);
    }

    #[test]
    fn output_is_sent_as_a_raw_frame_and_exit_as_json() {
        let output = event_body(PtyEvent::Output(vec![1, 2, 3])).unwrap();
        assert!(matches!(output, InvokeResponseBody::Raw(bytes) if bytes == [1, 2, 3]));

        let exit = event_body(PtyEvent::Exit { code: Some(7) }).unwrap();
        assert!(
            matches!(exit, InvokeResponseBody::Json(json) if json == r#"{"type":"exit","code":7}"#)
        );

        let unknown = event_body(PtyEvent::Exit { code: None }).unwrap();
        assert!(
            matches!(unknown, InvokeResponseBody::Json(json) if json == r#"{"type":"exit","code":null}"#)
        );
    }
}
