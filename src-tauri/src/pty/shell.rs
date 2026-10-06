use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

const NO_BANNER_FLAG: &str = "-NoLogo";

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
}

impl ShellEnv {
    pub fn current() -> Self {
        Self {
            windows: cfg!(windows),
            path: std::env::var_os("PATH"),
            login_shell: std::env::var_os("SHELL"),
        }
    }
}

pub fn default_shell(env: &ShellEnv, is_file: impl Fn(&Path) -> bool) -> ShellSpec {
    if !env.windows {
        let program = env
            .login_shell
            .clone()
            .filter(|shell| !shell.is_empty())
            .unwrap_or_else(|| OsString::from("/bin/sh"));
        return ShellSpec {
            program,
            args: Vec::new(),
        };
    }
    let program = ["pwsh.exe", "powershell.exe"]
        .iter()
        .find_map(|name| find_on_path(name, env.path.as_deref(), &is_file))
        .map_or_else(|| OsString::from("powershell.exe"), PathBuf::into_os_string);
    ShellSpec {
        program,
        args: vec![NO_BANNER_FLAG.to_owned()],
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

#[cfg(test)]
mod tests {
    use super::*;

    fn windows_env(path: &str) -> ShellEnv {
        ShellEnv {
            windows: true,
            path: Some(OsString::from(path)),
            login_shell: None,
        }
    }

    fn files(existing: &'static [&'static str]) -> impl Fn(&Path) -> bool {
        move |candidate| existing.iter().any(|file| candidate == Path::new(file))
    }

    #[test]
    fn prefers_pwsh_when_it_is_on_the_path() {
        let path = std::env::join_paths(["bin-a", "bin-b"]).unwrap();
        let env = ShellEnv {
            path: Some(path),
            ..windows_env("")
        };
        let shell = default_shell(&env, files(&["bin-b/pwsh.exe"]));

        assert_eq!(
            shell.program,
            OsString::from(Path::new("bin-b").join("pwsh.exe"))
        );
        assert_eq!(shell.args, vec!["-NoLogo".to_owned()]);
    }

    #[test]
    fn falls_back_to_windows_powershell_when_pwsh_is_missing() {
        let shell = default_shell(&windows_env("bin-a"), files(&[]));

        assert_eq!(shell.program, OsString::from("powershell.exe"));
        assert_eq!(shell.args, vec!["-NoLogo".to_owned()]);
    }

    #[test]
    fn finds_windows_powershell_on_the_path_when_pwsh_is_missing() {
        let shell = default_shell(&windows_env("sys"), files(&["sys/powershell.exe"]));

        assert_eq!(
            shell.program,
            OsString::from(Path::new("sys").join("powershell.exe"))
        );
    }

    #[test]
    fn unix_uses_the_login_shell_or_bin_sh() {
        let with_shell = ShellEnv {
            windows: false,
            path: None,
            login_shell: Some(OsString::from("/usr/bin/zsh")),
        };
        let without = ShellEnv {
            login_shell: None,
            ..with_shell.clone()
        };

        let spec = default_shell(&with_shell, files(&[]));
        assert_eq!(spec.program, OsString::from("/usr/bin/zsh"));
        assert!(spec.args.is_empty());
        assert_eq!(
            default_shell(&without, files(&[])).program,
            OsString::from("/bin/sh")
        );
    }

    #[test]
    fn find_on_path_handles_a_missing_path_variable() {
        assert_eq!(find_on_path("pwsh.exe", None, files(&[])), None);
    }
}
