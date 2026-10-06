use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use super::error::FsError;
use super::hub::{WatchBatch, WatchHub};
use super::ignore_rules::IgnoreMatcher;
use super::io::{self, FileRead};
use super::sandbox::{to_wire, Sandbox};
use super::tree::{self, DirListing};
use super::watcher::{self, WatchContext, WorkspaceWatcher};

#[derive(Clone)]
struct Workspace {
    sandbox: Arc<Sandbox>,
    matcher: Arc<IgnoreMatcher>,
}

struct ActiveWorkspace {
    workspace: Workspace,
    _watcher: WorkspaceWatcher,
}

/// Tauri-managed filesystem state: the open workspace, its watcher, and the
/// hub other Rust modules subscribe to for change batches.
#[derive(Clone, Default)]
pub struct FsState {
    inner: Arc<Inner>,
}

#[derive(Default)]
struct Inner {
    active: Mutex<Option<ActiveWorkspace>>,
    hub: WatchHub,
}

impl FsState {
    pub fn hub(&self) -> WatchHub {
        self.inner.hub.clone()
    }

    pub fn workspace_root(&self) -> Option<PathBuf> {
        self.lock()
            .as_ref()
            .map(|active| active.workspace.sandbox.root().to_path_buf())
    }

    pub fn open_workspace(&self, root: &str) -> Result<String, FsError> {
        let sandbox = Arc::new(Sandbox::open(root)?);
        let matcher = Arc::new(IgnoreMatcher::new(sandbox.root()));
        let canonical_root = to_wire(sandbox.root());
        let watcher = watcher::start(WatchContext {
            root: sandbox.root().to_path_buf(),
            matcher: Arc::clone(&matcher),
            hub: self.hub(),
        })?;
        let workspace = Workspace { sandbox, matcher };
        *self.lock() = Some(ActiveWorkspace {
            workspace,
            _watcher: watcher,
        });
        self.hub().publish(WatchBatch {
            root: canonical_root.clone(),
            changes: Vec::new(),
            rescan: true,
        });
        Ok(canonical_root)
    }

    pub fn close_workspace(&self) {
        *self.lock() = None;
    }

    pub fn list_dir(&self, path: &str) -> Result<DirListing, FsError> {
        let workspace = self.workspace()?;
        let dir = workspace.sandbox.resolve(path)?;
        tree::list_dir(&dir, &workspace.matcher)
    }

    pub fn read_file(&self, path: &str) -> Result<FileRead, FsError> {
        let file = self.workspace()?.sandbox.resolve(path)?;
        io::read_file(&file)
    }

    pub fn write_file(&self, path: &str, content: &str) -> Result<(), FsError> {
        let file = self.workspace()?.sandbox.resolve_writable(path)?;
        io::write_atomic(&file, content)
    }

    fn workspace(&self) -> Result<Workspace, FsError> {
        self.lock()
            .as_ref()
            .map(|active| active.workspace.clone())
            .ok_or(FsError::NoWorkspace)
    }

    fn lock(&self) -> MutexGuard<'_, Option<ActiveWorkspace>> {
        self.inner
            .active
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn open_state() -> (tempfile::TempDir, FsState) {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join(".git")).expect("git dir");
        fs::write(dir.path().join(".gitignore"), "dist/\n").expect("gitignore");
        fs::write(dir.path().join("a.ts"), "export {};\n").expect("a.ts");
        let state = FsState::default();
        state
            .open_workspace(dir.path().to_str().expect("utf8"))
            .expect("open");
        (dir, state)
    }

    #[test]
    fn commands_fail_before_a_workspace_is_open() {
        let state = FsState::default();
        assert_eq!(
            state.list_dir(".").expect_err("list").code(),
            "no_workspace"
        );
        assert_eq!(
            state.read_file("a").expect_err("read").code(),
            "no_workspace"
        );
        assert_eq!(
            state.write_file("a", "x").expect_err("write").code(),
            "no_workspace"
        );
        assert!(state.workspace_root().is_none());
    }

    #[test]
    fn open_returns_the_canonical_root_in_wire_form() {
        let (dir, state) = open_state();
        let root = state.workspace_root().expect("root");
        assert_eq!(root, dunce::canonicalize(dir.path()).expect("canonical"));
        let again = state
            .open_workspace(dir.path().to_str().expect("utf8"))
            .expect("reopen");
        assert_eq!(again, to_wire(&root));
        assert!(!again.contains('\\'));
    }

    #[test]
    fn lists_reads_and_writes_inside_the_workspace() {
        let (_dir, state) = open_state();
        let listing = state.list_dir(".").expect("list");
        let names: Vec<_> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, [".gitignore", "a.ts"]);

        state
            .write_file("src/../a.ts", "export const x = 1;\n")
            .expect("write");
        let read = state.read_file("a.ts").expect("read");
        assert_eq!(
            read,
            FileRead::Text {
                content: "export const x = 1;\n".to_owned(),
                size: 20
            }
        );
    }

    #[test]
    fn refuses_to_touch_paths_outside_the_workspace() {
        let (_dir, state) = open_state();
        let outside = tempfile::tempdir().expect("outside");
        let target = outside.path().join("secret.txt");
        fs::write(&target, "s").expect("write");
        let target = target.to_str().expect("utf8");
        assert_eq!(
            state.read_file(target).expect_err("read").code(),
            "outside_workspace"
        );
        assert_eq!(
            state.write_file(target, "x").expect_err("write").code(),
            "outside_workspace"
        );
        assert_eq!(
            state.list_dir("..").expect_err("list").code(),
            "outside_workspace"
        );
        assert_eq!(fs::read_to_string(target).expect("untouched"), "s");
    }

    #[test]
    fn refuses_writes_into_the_git_directory() {
        let (_dir, state) = open_state();
        let error = state.write_file(".git/config", "x").expect_err("write");
        assert_eq!(error.code(), "protected_path");
    }

    #[test]
    fn opening_a_workspace_tells_subscribers_to_rescan_it() {
        let state = FsState::default();
        let (_, events) = state.hub().subscribe();
        let dir = tempfile::tempdir().expect("tempdir");
        let root = state
            .open_workspace(dir.path().to_str().expect("utf8"))
            .expect("open");
        let batch = events.try_recv().expect("rescan batch on open");
        assert_eq!(batch.root, root);
        assert!(batch.rescan);
        assert!(batch.changes.is_empty());
    }

    #[test]
    fn close_drops_the_workspace() {
        let (_dir, state) = open_state();
        state.close_workspace();
        assert_eq!(
            state.read_file("a.ts").expect_err("read").code(),
            "no_workspace"
        );
    }
}
