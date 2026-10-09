//! A stand-in for the GitHub CLI, so the pull request commands are tested without GitHub.
//!
//! The runner is pointed at `git`, with an alias that runs a small shell script, so the script
//! receives exactly the arguments `gh` would. It needs nothing but git, on any platform. What it
//! answers is set per test with `set`; what it was asked is read back with `calls`.

use std::fs;
use std::path::Path;

use tempfile::TempDir;

use crate::git_cli::Git;

const ALIAS: &str = "fake-gh";
const CALL_END: &str = "<<end>>";
const MISSING_PROGRAM: &str = "flare-definitely-not-gh";

const SCRIPT: &str = r#"dir=$(dirname "$0")
{ printf '%s\n' "$@"; echo '<<end>>'; } >> "$dir/calls.log"
echo "$GH_PROMPT_DISABLED $GH_NO_UPDATE_NOTIFIER $NO_COLOR" > "$dir/env.log"
case "$1 $2" in
  "auth status")
    exit "$(cat "$dir/auth.exit")"
    ;;
  "repo view")
    if [ -f "$dir/repo.err" ]; then cat "$dir/repo.err" >&2; exit 1; fi
    cat "$dir/repo.json"
    ;;
  "pr view")
    if [ -f "$dir/view.err" ]; then cat "$dir/view.err" >&2; exit 1; fi
    cat "$dir/view.json"
    ;;
  "pr create")
    cat > "$dir/create.stdin"
    if [ -f "$dir/create.err" ]; then
      cat "$dir/create.err" >&2
      if [ -f "$dir/create.code" ]; then exit "$(cat "$dir/create.code")"; fi
      exit 1
    fi
    cat "$dir/create.out"
    ;;
  *)
    echo "the fake gh does not know: $*" >&2
    exit 2
    ;;
esac
"#;

pub struct FakeGh {
    dir: TempDir,
}

impl FakeGh {
    pub fn signed_in() -> Self {
        Self::with_auth_exit(0)
    }

    pub fn signed_out() -> Self {
        Self::with_auth_exit(1)
    }

    fn with_auth_exit(code: i32) -> Self {
        let fake = Self {
            dir: tempfile::tempdir().expect("fake gh dir"),
        };
        fake.set("fake-gh.sh", &SCRIPT.replace("\r\n", "\n"));
        fake.set("auth.exit", &code.to_string());
        fake
    }

    /// What the fake answers: `repo.json`, `view.json`, `create.out`, or `view.err`, `repo.err`
    /// and `create.err` to make that command fail with a message (`create.code` sets its status).
    pub fn set(&self, file: &str, content: &str) {
        fs::write(self.dir.path().join(file), content).expect("write fake gh file");
    }

    /// The runner to hand to the code under test, working in `cwd`.
    pub fn runner(&self, cwd: &Path) -> Git {
        let script = self.dir.path().join("fake-gh.sh");
        let script = script.to_string_lossy().replace('\\', "/");
        let alias = format!("alias.{ALIAS}=!sh \"{script}\"");
        Git::gh(cwd)
            .with_program("git")
            .with_global_args(["-c", alias.as_str(), ALIAS])
    }

    /// Every call so far, each as its arguments, oldest first.
    pub fn calls(&self) -> Vec<Vec<String>> {
        let log = fs::read_to_string(self.dir.path().join("calls.log")).unwrap_or_default();
        let mut calls = Vec::new();
        let mut current = Vec::new();
        for line in log.lines() {
            if line == CALL_END {
                calls.push(std::mem::take(&mut current));
            } else {
                current.push(line.to_owned());
            }
        }
        calls
    }

    pub fn call_names(&self) -> Vec<String> {
        self.calls()
            .iter()
            .map(|call| call.iter().take(2).cloned().collect::<Vec<_>>().join(" "))
            .collect()
    }

    pub fn create_stdin(&self) -> String {
        fs::read_to_string(self.dir.path().join("create.stdin")).expect("gh pr create ran")
    }

    pub fn env_line(&self) -> String {
        fs::read_to_string(self.dir.path().join("env.log"))
            .expect("gh ran")
            .trim()
            .to_owned()
    }
}

/// A runner for a machine where `gh` is not installed.
pub fn missing_gh(cwd: &Path) -> Git {
    Git::gh(cwd).with_program(MISSING_PROGRAM)
}
