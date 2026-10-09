use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// Shared with the bridge, which resolves the same executable for the SDK.
pub const CLAUDE_PATH_ENV: &str = "FLARE_CLAUDE_PATH";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellSpec {
    pub program: OsString,
    pub args: Vec<String>,
}

#[derive(Clone)]
pub struct ShellEnv {
    pub windows: bool,
    pub path: Option<OsString>,
    pub login_shell: Option<OsString>,
    pub comspec: Option<OsString>,
    pub program_files: Option<OsString>,
    pub claude_path: Option<OsString>,
}

impl ShellEnv {
    pub fn current() -> Self {
        Self {
            windows: cfg!(windows),
            path: std::env::var_os("PATH"),
            login_shell: std::env::var_os("SHELL"),
            comspec: std::env::var_os("ComSpec"),
            program_files: std::env::var_os("ProgramFiles"),
            claude_path: std::env::var_os(CLAUDE_PATH_ENV),
        }
    }
}

pub fn find_on_path(
    name: &str,
    path_var: Option<&OsStr>,
    is_file: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    std::env::split_paths(path_var?)
        .map(|dir| dir.join(name))
        .find(|candidate| is_file(candidate))
}

/// Not `Path::is_file`: Windows app-execution aliases (the Store `pwsh.exe`) are
/// reparse points that `metadata` cannot follow, but `symlink_metadata` can stat.
pub fn is_executable_candidate(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| !meta.is_dir())
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::home_dir().filter(|dir| !dir.as_os_str().is_empty())
}
