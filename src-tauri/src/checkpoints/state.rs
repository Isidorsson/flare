use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use super::error::CheckpointError;
use super::model::{
    CheckpointList, CreateRequest, DiffQuery, PlanQuery, PruneQuery, PruneReport, RestoreCommand,
    RestorePlan, RestoreResult, SessionQuery, Snapshot, TurnDiff,
};
use super::prune::{prune_stale, Policy};
use super::refs::{self, SessionId};
use super::service::Checkpoints;
use super::workspace::{existing_store, private_git, private_repo_dirs, Workspace};

const PRIVATE_REPOS_DIR: [&str; 2] = ["checkpoints", "repos"];

type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// Tauri-managed checkpoint state. Everything that writes to a repository runs one at a time, so
/// a snapshot never races a restore or a prune.
#[derive(Clone)]
pub struct CheckpointState {
    inner: Arc<Inner>,
}

struct Inner {
    private_repos: PathBuf,
    clock: Clock,
    policy: Policy,
    writes: Mutex<()>,
}

impl CheckpointState {
    /// `data_dir` is the app data directory; private repositories live beneath it.
    pub fn new(data_dir: &Path) -> Self {
        Self::with_parts(data_dir, Arc::new(unix_now), Policy::DEFAULT)
    }

    pub fn with_parts(data_dir: &Path, clock: Clock, policy: Policy) -> Self {
        Self {
            inner: Arc::new(Inner {
                private_repos: PRIVATE_REPOS_DIR
                    .iter()
                    .fold(data_dir.to_path_buf(), |dir, part| dir.join(part)),
                clock,
                policy,
                writes: Mutex::new(()),
            }),
        }
    }

    pub fn create(&self, request: CreateRequest) -> Result<Snapshot, CheckpointError> {
        let session = SessionId::parse(&request.session_id)?;
        let workspace = self.workspace(&request.root)?;
        self.exclusive(|| {
            self.checkpoints(&workspace, session)
                .create(request.phase, request.turn)
        })
    }

    pub fn list(&self, query: SessionQuery) -> Result<CheckpointList, CheckpointError> {
        let session = SessionId::parse(&query.session_id)?;
        let workspace = self.workspace(&query.root)?;
        self.checkpoints(&workspace, session).list()
    }

    pub fn diff(&self, query: DiffQuery) -> Result<TurnDiff, CheckpointError> {
        let session = SessionId::parse(&query.session_id)?;
        let workspace = self.workspace(&query.root)?;
        self.checkpoints(&workspace, session).turn_diff(query.turn)
    }

    /// Taking the current snapshot writes objects (and a private repository's index).
    pub fn plan(&self, query: PlanQuery) -> Result<RestorePlan, CheckpointError> {
        let session = SessionId::parse(&query.session_id)?;
        let workspace = self.workspace(&query.root)?;
        self.exclusive(|| self.checkpoints(&workspace, session).plan(query.request))
    }

    pub fn restore(&self, command: RestoreCommand) -> Result<RestoreResult, CheckpointError> {
        let session = SessionId::parse(&command.session_id)?;
        let workspace = self.workspace(&command.root)?;
        self.exclusive(|| {
            self.checkpoints(&workspace, session)
                .restore(command.request, command.force)
        })
    }

    /// Drops sessions older than the retention period from the workspace's repository.
    pub fn prune(&self, query: PruneQuery) -> Result<PruneReport, CheckpointError> {
        let Some(git) = existing_store(&query.root, &self.inner.private_repos)? else {
            return Ok(PruneReport { removed_refs: 0 });
        };
        let removed_refs = self.exclusive(|| prune_stale(&git, self.now(), self.inner.policy))?;
        Ok(PruneReport { removed_refs })
    }

    /// Does the same for every private repository, deleting those left with nothing to restore.
    pub fn sweep_private_repos(&self) -> Result<PruneReport, CheckpointError> {
        self.exclusive(|| {
            let mut removed_refs = 0;
            for dir in private_repo_dirs(&self.inner.private_repos)? {
                let git = private_git(&dir);
                let removed = prune_stale(&git, self.now(), self.inner.policy)?;
                removed_refs += removed;
                if refs::list_all(&git)?.is_empty() {
                    fs::remove_dir_all(&dir).map_err(|error| CheckpointError::io(&dir, error))?;
                } else if removed > 0 {
                    git.command(["gc", "--prune=now", "--quiet"]).run()?;
                }
            }
            Ok(PruneReport { removed_refs })
        })
    }

    fn workspace(&self, root: &str) -> Result<Workspace, CheckpointError> {
        Workspace::resolve(root, &self.inner.private_repos)
    }

    fn checkpoints<'a>(&self, workspace: &'a Workspace, session: SessionId) -> Checkpoints<'a> {
        Checkpoints {
            workspace,
            session,
            now: self.now(),
            policy: self.inner.policy,
        }
    }

    fn now(&self) -> i64 {
        (self.inner.clock)()
    }

    fn exclusive<T>(&self, work: impl FnOnce() -> T) -> T {
        let _turn = self
            .inner
            .writes
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        work()
    }
}

/// A clock set before 1970 reads as 0, which makes every snapshot look new and so keeps them all.
fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX)
        })
}
