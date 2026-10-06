//! A throwaway workspace (a real git repository or a plain folder) and helpers for driving the
//! checkpoint state against it and checking the result with the real `git`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use tempfile::TempDir;

use crate::checkpoints::error::CheckpointError;
use crate::checkpoints::model::{
    CheckpointList, CreateRequest, DiffQuery, Phase, PlanQuery, PlannedFile, PruneQuery,
    PruneReport, RestoreCommand, RestorePlan, RestoreRequest, RestoreResult, SessionQuery,
    Snapshot, TurnDiff,
};
use crate::checkpoints::prune::Policy;
use crate::checkpoints::CheckpointState;

pub const SESSION: &str = "session-1";
pub const START_TIME: i64 = 1_700_000_000;

/// Local settings that make test repositories independent of the machine's git configuration.
const REPO_CONFIG: &str = "[user]\n\tname = Test\n\temail = test@example.com\n[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n";

pub struct Fixture {
    _workspace: TempDir,
    _data: TempDir,
    /// The folder checkpoints are taken of.
    pub root: PathBuf,
    /// The top of the temporary directory, which is `root` unless `in_subfolder` moved it.
    pub top: PathBuf,
    pub data: PathBuf,
    pub state: CheckpointState,
    clock: Arc<AtomicI64>,
}

impl Fixture {
    /// A git repository with one commit holding `a.txt`, `b.txt` and `keep.txt`.
    pub fn repo() -> Self {
        let fixture = Self::folder();
        fixture.git(&["init", "--quiet"]);
        // Written straight into the config: every git process costs a noticeable fraction of a second on Windows.
        let config = fixture.path(".git/config");
        let mut text = fs::read_to_string(&config).expect("read config");
        text.push_str(REPO_CONFIG);
        fs::write(&config, text).expect("write config");
        fixture.write("a.txt", "a1\n");
        fixture.write("b.txt", "b1\n");
        fixture.write("keep.txt", "keep\n");
        fixture.git(&["add", "-A"]);
        fixture.git(&["commit", "--quiet", "-m", "initial"]);
        fixture
    }

    /// A plain folder with the same three files and no repository.
    pub fn plain() -> Self {
        let fixture = Self::folder();
        fixture.write("a.txt", "a1\n");
        fixture.write("b.txt", "b1\n");
        fixture.write("keep.txt", "keep\n");
        fixture
    }

    pub fn with_policy(policy: Policy) -> Self {
        let mut fixture = Self::repo();
        fixture.state = CheckpointState::with_parts(&fixture.data, fixture.clock_fn(), policy);
        fixture
    }

    fn folder() -> Self {
        let workspace = tempfile::tempdir().expect("workspace dir");
        let data = tempfile::tempdir().expect("data dir");
        let root = dunce::canonicalize(workspace.path()).expect("canonical workspace");
        let data_path = dunce::canonicalize(data.path()).expect("canonical data");
        let clock = Arc::new(AtomicI64::new(START_TIME));
        let reader = Arc::clone(&clock);
        let state = CheckpointState::with_parts(
            &data_path,
            Arc::new(move || reader.load(Ordering::SeqCst)),
            Policy::DEFAULT,
        );
        Self {
            _workspace: workspace,
            _data: data,
            top: root.clone(),
            root,
            data: data_path,
            state,
            clock,
        }
    }

    /// Makes a folder inside the temporary directory the workspace, as when a project is opened
    /// at a package inside a larger repository.
    pub fn in_subfolder(mut self, relative: &str) -> Self {
        self.root = self.top.join(relative);
        fs::create_dir_all(&self.root).expect("create subfolder");
        self
    }

    /// Points the fixture at another existing folder, such as a linked worktree.
    pub fn at(mut self, root: PathBuf) -> Self {
        self.root = dunce::canonicalize(root).expect("canonical folder");
        self
    }

    pub fn write_top(&self, relative: &str, content: &str) {
        let path = self.top.join(relative);
        fs::create_dir_all(path.parent().expect("parent")).expect("create parents");
        fs::write(path, content).expect("write file");
    }

    pub fn read_top(&self, relative: &str) -> String {
        fs::read_to_string(self.top.join(relative)).expect("read file")
    }

    fn clock_fn(&self) -> Arc<dyn Fn() -> i64 + Send + Sync> {
        let reader = Arc::clone(&self.clock);
        Arc::new(move || reader.load(Ordering::SeqCst))
    }

    pub fn root_str(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    pub fn write(&self, relative: &str, content: &str) {
        self.write_bytes(relative, content.as_bytes());
    }

    pub fn write_bytes(&self, relative: &str, content: &[u8]) {
        let path = self.path(relative);
        fs::create_dir_all(path.parent().expect("parent")).expect("create parents");
        fs::write(path, content).expect("write file");
    }

    pub fn read(&self, relative: &str) -> String {
        fs::read_to_string(self.path(relative)).expect("read file")
    }

    pub fn read_bytes(&self, relative: &str) -> Vec<u8> {
        fs::read(self.path(relative)).expect("read file")
    }

    pub fn exists(&self, relative: &str) -> bool {
        self.path(relative).exists()
    }

    pub fn remove(&self, relative: &str) {
        fs::remove_file(self.path(relative)).expect("remove file");
    }

    /// Runs real git in the workspace and returns its trimmed standard output.
    pub fn git(&self, args: &[&str]) -> String {
        run_git(&self.root, args)
    }

    pub fn advance(&self, seconds: i64) {
        self.clock.fetch_add(seconds, Ordering::SeqCst);
    }

    pub fn start(&self) -> Snapshot {
        self.start_session(SESSION)
    }

    pub fn start_session(&self, session: &str) -> Snapshot {
        self.try_create(session, Phase::Start, None)
            .expect("start snapshot")
    }

    pub fn end(&self, turn: u32) -> Snapshot {
        self.try_create(SESSION, Phase::End, Some(turn))
            .expect("end snapshot")
    }

    pub fn try_create(
        &self,
        session: &str,
        phase: Phase,
        turn: Option<u32>,
    ) -> Result<Snapshot, CheckpointError> {
        self.state.create(CreateRequest {
            root: self.root_str(),
            session_id: session.to_owned(),
            phase,
            turn,
        })
    }

    /// Runs one agent turn: snapshot, let `work` change files, snapshot again. Returns the turn.
    pub fn turn(&self, work: impl FnOnce(&Self)) -> u32 {
        let turn = self.start().turn;
        work(self);
        self.end(turn);
        turn
    }

    pub fn list(&self) -> CheckpointList {
        self.state
            .list(SessionQuery {
                root: self.root_str(),
                session_id: SESSION.to_owned(),
            })
            .expect("list")
    }

    pub fn diff(&self, turn: u32) -> TurnDiff {
        self.state
            .diff(DiffQuery {
                root: self.root_str(),
                session_id: SESSION.to_owned(),
                turn,
            })
            .expect("diff")
    }

    pub fn plan(&self, request: RestoreRequest) -> RestorePlan {
        self.try_plan(request).expect("plan")
    }

    pub fn try_plan(&self, request: RestoreRequest) -> Result<RestorePlan, CheckpointError> {
        self.state.plan(PlanQuery {
            root: self.root_str(),
            session_id: SESSION.to_owned(),
            request,
        })
    }

    pub fn restore(&self, request: RestoreRequest, force: bool) -> RestoreResult {
        self.try_restore(request, force).expect("restore")
    }

    pub fn try_restore(
        &self,
        request: RestoreRequest,
        force: bool,
    ) -> Result<RestoreResult, CheckpointError> {
        self.state.restore(RestoreCommand {
            root: self.root_str(),
            session_id: SESSION.to_owned(),
            request,
            force,
        })
    }

    /// Restores and returns the id to redo it with, failing if the restore did not happen.
    pub fn restored(&self, request: RestoreRequest, force: bool) -> u32 {
        match self.restore(request, force) {
            RestoreResult::Restored { restore, .. } => restore,
            other => panic!("expected the restore to happen, got {other:?}"),
        }
    }

    pub fn prune(&self) -> PruneReport {
        self.state
            .prune(PruneQuery {
                root: self.root_str(),
            })
            .expect("prune")
    }

    /// Every ref under `refs/flare/`, as `name` lines.
    pub fn flare_refs(&self) -> Vec<String> {
        let listed = self.git(&["for-each-ref", "--format=%(refname)", "refs/flare/"]);
        listed.lines().map(str::to_owned).collect()
    }
}

pub fn run_git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_owned()
}

pub fn paths_of(files: &[PlannedFile]) -> Vec<String> {
    let mut paths: Vec<String> = files.iter().map(|file| file.path.clone()).collect();
    paths.sort();
    paths
}

pub fn conflicts_of(files: &[PlannedFile]) -> Vec<String> {
    let mut paths: Vec<String> = files
        .iter()
        .filter(|file| file.conflict)
        .map(|file| file.path.clone())
        .collect();
    paths.sort();
    paths
}
