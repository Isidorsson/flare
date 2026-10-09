use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use crate::git_cli::Git;

use super::error::VcsError;
use super::model::{
    BranchRequest, CommitRequest, CommitResult, DeleteBranchRequest, FileDiff, FileDiffRequest,
    MessageContext, PathsRequest, PrContext, PrContextRequest, PrCreateRequest, PrCreated, PrInfo,
    RootRequest, VcsBranch, VcsStatus,
};
use super::repo::Repo;
use super::{
    branches, commit, diff, message_context, paths, pr_context, pr_create, pr_info, remote,
    staging, status,
};

type RepoLocks = Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>;

/// Tauri-managed state. Git takes `index.lock` for anything that writes the index, so two clicks
/// in quick succession would make the second fail with "Unable to create index.lock". Commands
/// that change the index, the working tree or HEAD therefore queue per repository instead.
/// Reads never wait, and neither do fetch and a plain push, which touch neither.
#[derive(Clone, Default)]
pub struct VcsState {
    locks: Arc<RepoLocks>,
}

impl VcsState {
    /// A folder outside any repository is an answer (`isRepo: false`), not a failure.
    pub fn status(&self, request: RootRequest) -> Result<VcsStatus, VcsError> {
        match Repo::find(&request.root)? {
            Some(repo) => status::read(&repo),
            None => Ok(VcsStatus::not_a_repo()),
        }
    }

    pub fn file_diff(&self, request: FileDiffRequest) -> Result<FileDiff, VcsError> {
        diff::file_diff(&Repo::open(&request.root)?, &request.path, request.staged)
    }

    pub fn stage(&self, request: PathsRequest) -> Result<VcsStatus, VcsError> {
        paths::validate_all(&request.paths)?;
        self.change_index(&request.root, |repo| staging::stage(repo, &request.paths))
    }

    pub fn unstage(&self, request: PathsRequest) -> Result<VcsStatus, VcsError> {
        paths::validate_all(&request.paths)?;
        self.change_index(&request.root, |repo| staging::unstage(repo, &request.paths))
    }

    pub fn discard(&self, request: PathsRequest) -> Result<VcsStatus, VcsError> {
        paths::validate_all(&request.paths)?;
        self.change_index(&request.root, |repo| staging::discard(repo, &request.paths))
    }

    pub fn commit(&self, request: CommitRequest) -> Result<CommitResult, VcsError> {
        let repo = Repo::open(&request.root)?;
        let committed = self.exclusive(&repo, || commit::commit(&repo, &request.message))?;
        Ok(CommitResult {
            commit: committed.commit,
            summary: committed.summary,
            status: status::read(&repo)?,
        })
    }

    pub fn branches(&self, request: RootRequest) -> Result<Vec<VcsBranch>, VcsError> {
        branches::list(&Repo::open(&request.root)?)
    }

    pub fn branch_create(&self, request: BranchRequest) -> Result<VcsStatus, VcsError> {
        self.change_index(&request.root, |repo| branches::create(repo, &request.name))
    }

    pub fn switch(&self, request: BranchRequest) -> Result<VcsStatus, VcsError> {
        self.change_index(&request.root, |repo| branches::switch(repo, &request.name))
    }

    pub fn branch_delete(&self, request: DeleteBranchRequest) -> Result<VcsStatus, VcsError> {
        self.change_index(&request.root, |repo| {
            branches::delete(repo, &request.name, request.force)
        })
    }

    pub fn fetch(&self, request: RootRequest) -> Result<VcsStatus, VcsError> {
        let repo = Repo::open(&request.root)?;
        remote::fetch(&repo)?;
        status::read(&repo)
    }

    pub fn pull(&self, request: RootRequest) -> Result<VcsStatus, VcsError> {
        self.change_index(&request.root, remote::pull)
    }

    pub fn push(&self, request: RootRequest) -> Result<VcsStatus, VcsError> {
        let repo = Repo::open(&request.root)?;
        remote::push(&repo)?;
        status::read(&repo)
    }

    pub fn message_context(&self, request: RootRequest) -> Result<MessageContext, VcsError> {
        message_context::context(&Repo::open(&request.root)?)
    }

    pub fn pr_info(&self, request: RootRequest) -> Result<PrInfo, VcsError> {
        let repo = Repo::open(&request.root)?;
        pr_info::read(&repo, &Git::gh(repo.top()))
    }

    pub fn pr_context(&self, request: PrContextRequest) -> Result<PrContext, VcsError> {
        pr_context::read(&Repo::open(&request.root)?, &request.base)
    }

    pub fn pr_create(&self, request: PrCreateRequest) -> Result<PrCreated, VcsError> {
        let repo = Repo::open(&request.root)?;
        self.create_pull_request(&repo, &Git::gh(repo.top()), &request)
    }

    /// Takes the `gh` runner as an argument so tests can stand in for GitHub.
    pub(super) fn create_pull_request(
        &self,
        repo: &Repo,
        gh: &Git,
        request: &PrCreateRequest,
    ) -> Result<PrCreated, VcsError> {
        let plan = pr_create::prepare(repo, gh, request)?;
        if plan.needs_push {
            self.exclusive(repo, || remote::push(repo))?;
        }
        let pr = pr_create::submit(gh, request, &plan.branch)?;
        Ok(PrCreated {
            pr,
            status: status::read(repo)?,
        })
    }

    /// Runs `work` with the repository to itself, then reports how it looks afterwards.
    fn change_index(
        &self,
        root: &str,
        work: impl FnOnce(&Repo) -> Result<(), VcsError>,
    ) -> Result<VcsStatus, VcsError> {
        let repo = Repo::open(root)?;
        self.exclusive(&repo, || work(&repo))?;
        status::read(&repo)
    }

    fn exclusive<T>(&self, repo: &Repo, work: impl FnOnce() -> T) -> T {
        let lock = {
            let mut locks = self.locks.lock().unwrap_or_else(PoisonError::into_inner);
            Arc::clone(locks.entry(repo.top().to_path_buf()).or_default())
        };
        // The guarded value is `()`, so a panic in an earlier holder cannot have left it inconsistent.
        let _turn = lock.lock().unwrap_or_else(PoisonError::into_inner);
        work()
    }
}
