use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::error::PtyError;
use super::shell::{find_on_path, ShellEnv, ShellSpec};

const CLAUDE_PROFILE_ID: &str = "claude";
const SESSION_ID_LEN: usize = 36;
const WINDOWS_SHIM_EXTENSIONS: [&str; 2] = ["cmd", "bat"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileKind {
    Shell,
    Claude,
}

/// What the frontend may launch. The program behind each id stays here, so the
/// webview can only pick from detected programs, never name an arbitrary one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub label: String,
    pub kind: ProfileKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileEntry {
    pub profile: Profile,
    pub spec: ShellSpec,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Launch {
    /// `None` is the system default shell.
    Shell { profile: Option<String> },
    /// `resume` forks an existing Claude session so the chat keeps its own copy.
    Claude { resume: Option<String> },
}

struct Candidate {
    id: &'static str,
    label: &'static str,
    program: Option<PathBuf>,
    args: &'static [&'static str],
}

/// Shells first with the default at the front, then Claude Code when it is installed.
pub fn detect_profiles(env: &ShellEnv, is_file: impl Fn(&Path) -> bool) -> Vec<ProfileEntry> {
    let mut entries = if env.windows {
        windows_shells(env, &is_file)
    } else {
        unix_shells(env, &is_file)
    };
    entries.extend(claude_entry(env, &is_file));
    entries
}

pub fn resolve_launch(launch: &Launch, entries: &[ProfileEntry]) -> Result<ShellSpec, PtyError> {
    match launch {
        Launch::Shell { profile: None } => entries
            .iter()
            .find(|entry| entry.profile.kind == ProfileKind::Shell)
            .map(|entry| entry.spec.clone())
            .ok_or_else(|| PtyError::InvalidRequest("no shell was found".into())),
        Launch::Shell { profile: Some(id) } => entries
            .iter()
            .find(|entry| entry.profile.kind == ProfileKind::Shell && entry.profile.id == *id)
            .map(|entry| entry.spec.clone())
            .ok_or_else(|| PtyError::InvalidRequest(format!("unknown shell profile {id}"))),
        Launch::Claude { resume } => claude_launch(resume.as_deref(), entries),
    }
}

fn claude_launch(resume: Option<&str>, entries: &[ProfileEntry]) -> Result<ShellSpec, PtyError> {
    let mut spec = entries
        .iter()
        .find(|entry| entry.profile.kind == ProfileKind::Claude)
        .map(|entry| entry.spec.clone())
        .ok_or_else(|| {
            PtyError::InvalidRequest(
                "Claude Code was not found on PATH. Install it or set FLARE_CLAUDE_PATH".into(),
            )
        })?;
    if let Some(session) = resume {
        if !is_session_id(session) {
            return Err(PtyError::InvalidRequest(format!(
                "{session} is not a Claude session id"
            )));
        }
        spec.args.extend([
            "--resume".to_owned(),
            session.to_owned(),
            "--fork-session".to_owned(),
        ]);
    }
    Ok(spec)
}

/// Session ids become command-line arguments, so only the UUID shape is accepted.
fn is_session_id(value: &str) -> bool {
    value.len() == SESSION_ID_LEN
        && value
            .chars()
            .all(|char| char.is_ascii_hexdigit() || char == '-')
}

fn windows_shells(env: &ShellEnv, is_file: &impl Fn(&Path) -> bool) -> Vec<ProfileEntry> {
    let on_path = |name: &str| find_on_path(name, env.path.as_deref(), is_file);
    let powershell = on_path("powershell.exe").or_else(|| Some(PathBuf::from("powershell.exe")));
    let cmd = env
        .comspec
        .clone()
        .map(PathBuf::from)
        .or_else(|| on_path("cmd.exe"));
    let candidates = [
        Candidate {
            id: "pwsh",
            label: "PowerShell",
            program: on_path("pwsh.exe"),
            args: &["-NoLogo"],
        },
        Candidate {
            id: "powershell",
            label: "Windows PowerShell",
            program: powershell,
            args: &["-NoLogo"],
        },
        Candidate {
            id: "cmd",
            label: "Command Prompt",
            program: cmd,
            args: &[],
        },
        Candidate {
            id: "git-bash",
            label: "Git Bash",
            program: git_bash(env, is_file),
            args: &["--login", "-i"],
        },
        Candidate {
            id: "wsl",
            label: "WSL",
            program: on_path("wsl.exe"),
            args: &[],
        },
        Candidate {
            id: "nu",
            label: "Nushell",
            program: on_path("nu.exe"),
            args: &[],
        },
    ];
    candidates.into_iter().filter_map(shell_entry).collect()
}

/// Git for Windows puts `git.exe` on PATH from `<root>\cmd`; bash lives in `<root>\bin`.
fn git_bash(env: &ShellEnv, is_file: &impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let from_git = find_on_path("git.exe", env.path.as_deref(), is_file)
        .and_then(|git| git.parent()?.parent().map(Path::to_path_buf));
    let from_program_files = env
        .program_files
        .as_ref()
        .map(|dir| Path::new(dir).join("Git"));
    [from_git, from_program_files]
        .into_iter()
        .flatten()
        .map(|root| root.join("bin").join("bash.exe"))
        .find(|bash| is_file(bash))
}

fn unix_shells(env: &ShellEnv, is_file: &impl Fn(&Path) -> bool) -> Vec<ProfileEntry> {
    let login = env
        .login_shell
        .clone()
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| OsString::from("/bin/sh"));
    let mut entries = vec![unix_entry(PathBuf::from(login))];
    for name in ["bash", "zsh", "fish", "nu"] {
        let Some(program) = find_on_path(name, env.path.as_deref(), is_file) else {
            continue;
        };
        if entries.iter().all(|entry| entry.profile.id != name) {
            entries.push(unix_entry(program));
        }
    }
    entries
}

fn unix_entry(program: PathBuf) -> ProfileEntry {
    let name = program.file_name().map_or_else(
        || "shell".to_owned(),
        |name| name.to_string_lossy().into_owned(),
    );
    ProfileEntry {
        profile: Profile {
            id: name.clone(),
            label: name,
            kind: ProfileKind::Shell,
        },
        spec: ShellSpec {
            program: program.into_os_string(),
            args: Vec::new(),
        },
    }
}

fn shell_entry(candidate: Candidate) -> Option<ProfileEntry> {
    let program = candidate.program?;
    Some(ProfileEntry {
        profile: Profile {
            id: candidate.id.to_owned(),
            label: candidate.label.to_owned(),
            kind: ProfileKind::Shell,
        },
        spec: ShellSpec {
            program: program.into_os_string(),
            args: candidate.args.iter().map(|arg| (*arg).to_owned()).collect(),
        },
    })
}

fn claude_entry(env: &ShellEnv, is_file: &impl Fn(&Path) -> bool) -> Option<ProfileEntry> {
    let program = env
        .claude_path
        .clone()
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            let names: &[&str] = if env.windows {
                &["claude.exe", "claude.cmd"]
            } else {
                &["claude"]
            };
            names
                .iter()
                .find_map(|name| find_on_path(name, env.path.as_deref(), is_file))
        })?;
    Some(ProfileEntry {
        profile: Profile {
            id: CLAUDE_PROFILE_ID.to_owned(),
            label: "Claude Code".to_owned(),
            kind: ProfileKind::Claude,
        },
        spec: claude_spec(env, program),
    })
}

/// npm installs `claude.cmd`, which CreateProcess cannot start without cmd.exe.
fn claude_spec(env: &ShellEnv, program: PathBuf) -> ShellSpec {
    let is_shim = program
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            WINDOWS_SHIM_EXTENSIONS
                .iter()
                .any(|shim| ext.eq_ignore_ascii_case(shim))
        });
    if !is_shim {
        return ShellSpec {
            program: program.into_os_string(),
            args: Vec::new(),
        };
    }
    let cmd = env
        .comspec
        .clone()
        .unwrap_or_else(|| OsString::from("cmd.exe"));
    ShellSpec {
        program: cmd,
        args: vec![
            "/d".to_owned(),
            "/c".to_owned(),
            program.to_string_lossy().into_owned(),
        ],
    }
}
