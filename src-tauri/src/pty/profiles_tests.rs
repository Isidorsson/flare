use std::ffi::OsString;
use std::path::Path;

use super::error::PtyError;
use super::profiles::{detect_profiles, resolve_launch, Launch, ProfileEntry, ProfileKind};
use super::shell::{ShellEnv, ShellSpec};

const SESSION: &str = "0f8b6c1e-4a2d-4c3b-9e7f-1a2b3c4d5e6f";

fn windows_env(dirs: &[&str]) -> ShellEnv {
    ShellEnv {
        windows: true,
        path: Some(std::env::join_paths(dirs).unwrap()),
        login_shell: None,
        comspec: Some(OsString::from("C:/Windows/System32/cmd.exe")),
        program_files: None,
        claude_path: None,
    }
}

fn unix_env(login_shell: Option<&str>, dirs: &[&str]) -> ShellEnv {
    ShellEnv {
        windows: false,
        path: Some(std::env::join_paths(dirs).unwrap()),
        login_shell: login_shell.map(OsString::from),
        comspec: None,
        program_files: None,
        claude_path: None,
    }
}

fn files(existing: &'static [&'static str]) -> impl Fn(&Path) -> bool {
    move |candidate| existing.iter().any(|file| candidate == Path::new(file))
}

fn ids(entries: &[ProfileEntry]) -> Vec<&str> {
    entries
        .iter()
        .map(|entry| entry.profile.id.as_str())
        .collect()
}

fn program(entries: &[ProfileEntry], id: &str) -> OsString {
    entries
        .iter()
        .find(|entry| entry.profile.id == id)
        .map(|entry| entry.spec.program.clone())
        .unwrap()
}

#[test]
fn windows_lists_found_shells_with_pwsh_as_the_default() {
    let entries = detect_profiles(
        &windows_env(&["bin", "sys"]),
        files(&["bin/pwsh.exe", "sys/powershell.exe", "sys/wsl.exe"]),
    );

    assert_eq!(ids(&entries), ["pwsh", "powershell", "cmd", "wsl"]);
    assert_eq!(
        program(&entries, "pwsh"),
        Path::new("bin").join("pwsh.exe").into_os_string()
    );
    let default = resolve_launch(&Launch::Shell { profile: None }, &entries).unwrap();
    assert_eq!(default.args, ["-NoLogo"]);
    assert_eq!(default.program, program(&entries, "pwsh"));
}

#[test]
fn windows_falls_back_to_windows_powershell_by_name() {
    let entries = detect_profiles(&windows_env(&["bin"]), files(&[]));

    assert_eq!(ids(&entries), ["powershell", "cmd"]);
    assert_eq!(
        program(&entries, "powershell"),
        OsString::from("powershell.exe")
    );
}

#[test]
fn git_bash_is_found_next_to_git_on_the_path() {
    let entries = detect_profiles(
        &windows_env(&["Git/cmd"]),
        files(&["Git/cmd/git.exe", "Git/bin/bash.exe"]),
    );

    let bash = entries
        .iter()
        .find(|entry| entry.profile.id == "git-bash")
        .unwrap();
    assert_eq!(
        bash.spec.program,
        Path::new("Git")
            .join("bin")
            .join("bash.exe")
            .into_os_string()
    );
    assert_eq!(bash.spec.args, ["--login", "-i"]);
}

#[test]
fn git_bash_falls_back_to_program_files() {
    let env = ShellEnv {
        program_files: Some(OsString::from("PF")),
        ..windows_env(&[])
    };
    let entries = detect_profiles(&env, files(&["PF/Git/bin/bash.exe"]));

    assert_eq!(
        program(&entries, "git-bash"),
        Path::new("PF")
            .join("Git")
            .join("bin")
            .join("bash.exe")
            .into_os_string()
    );
}

#[test]
fn unix_puts_the_login_shell_first_and_skips_duplicates() {
    let entries = detect_profiles(
        &unix_env(Some("/usr/bin/zsh"), &["/usr/bin"]),
        files(&["/usr/bin/zsh", "/usr/bin/bash"]),
    );

    assert_eq!(ids(&entries), ["zsh", "bash"]);
    assert_eq!(program(&entries, "zsh"), OsString::from("/usr/bin/zsh"));
}

#[test]
fn unix_without_a_login_shell_uses_bin_sh() {
    let entries = detect_profiles(&unix_env(None, &[]), files(&[]));
    assert_eq!(ids(&entries), ["sh"]);
}

#[test]
fn a_named_profile_resolves_and_an_unknown_one_fails() {
    let entries = detect_profiles(&windows_env(&["sys"]), files(&["sys/wsl.exe"]));

    let wsl = resolve_launch(
        &Launch::Shell {
            profile: Some("wsl".into()),
        },
        &entries,
    )
    .unwrap();
    assert_eq!(wsl.program, program(&entries, "wsl"));
    let unknown = resolve_launch(
        &Launch::Shell {
            profile: Some("zsh".into()),
        },
        &entries,
    );
    assert!(matches!(unknown, Err(PtyError::InvalidRequest(message)) if message.contains("zsh")));
}

#[test]
fn claude_is_not_a_shell_profile() {
    let entries = detect_profiles(&windows_env(&["bin"]), files(&["bin/claude.exe"]));

    assert_eq!(entries.last().unwrap().profile.kind, ProfileKind::Claude);
    assert!(resolve_launch(
        &Launch::Shell {
            profile: Some("claude".into())
        },
        &entries
    )
    .is_err());
}

#[test]
fn claude_launches_fresh_or_forks_a_session() {
    let entries = detect_profiles(&windows_env(&["bin"]), files(&["bin/claude.exe"]));

    let fresh = resolve_launch(&Launch::Claude { resume: None }, &entries).unwrap();
    assert_eq!(
        fresh,
        ShellSpec {
            program: Path::new("bin").join("claude.exe").into_os_string(),
            args: vec![]
        }
    );
    let resumed = resolve_launch(
        &Launch::Claude {
            resume: Some(SESSION.into()),
        },
        &entries,
    )
    .unwrap();
    assert_eq!(resumed.args, ["--resume", SESSION, "--fork-session"]);
}

#[test]
fn claude_rejects_a_resume_that_is_not_a_session_id() {
    let entries = detect_profiles(&windows_env(&["bin"]), files(&["bin/claude.exe"]));

    for bad in [
        "--dangerously-skip-permissions",
        "",
        "0f8b6c1e 4a2d 4c3b 9e7f 1a2b3c4d5e6f",
    ] {
        let launch = Launch::Claude {
            resume: Some(bad.into()),
        };
        assert!(
            resolve_launch(&launch, &entries).is_err(),
            "{bad:?} was accepted"
        );
    }
}

#[test]
fn claude_npm_shim_runs_through_cmd() {
    let entries = detect_profiles(&windows_env(&["npm"]), files(&["npm/claude.cmd"]));

    let spec = resolve_launch(&Launch::Claude { resume: None }, &entries).unwrap();
    assert_eq!(spec.program, OsString::from("C:/Windows/System32/cmd.exe"));
    assert_eq!(spec.args[..2], ["/d", "/c"]);
    assert!(spec.args[2].ends_with("claude.cmd"));
}

#[test]
fn configured_claude_path_wins_over_the_path() {
    let env = ShellEnv {
        claude_path: Some(OsString::from("D:/tools/claude.exe")),
        ..windows_env(&["bin"])
    };
    let entries = detect_profiles(&env, files(&["bin/claude.exe"]));

    assert_eq!(
        program(&entries, "claude"),
        OsString::from("D:/tools/claude.exe")
    );
}

#[test]
fn claude_launch_fails_when_claude_is_missing() {
    let entries = detect_profiles(&windows_env(&[]), files(&[]));
    let error = resolve_launch(&Launch::Claude { resume: None }, &entries).unwrap_err();
    assert!(
        matches!(error, PtyError::InvalidRequest(message) if message.contains("FLARE_CLAUDE_PATH"))
    );
}
