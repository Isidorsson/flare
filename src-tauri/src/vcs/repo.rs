use std::path::{Path, PathBuf};

use crate::git_cli::{Git, Invocation};

use super::error::VcsError;

const GIT_ENTRY: &str = ".git";
const NO_OPTIONAL_LOCKS_ENV: &str = "GIT_OPTIONAL_LOCKS";

/// A work tree git commands run in. `top` is the folder holding `.git`, which may be above the
/// folder the user opened; every path in this module is relative to it, as in git's own output.
#[derive(Debug)]
pub struct Repo {
    top: PathBuf,
    git: Git,
}

impl Repo {
    /// The repository `root` belongs to, or `None` for a folder outside any repository. Looking
    /// for `.git` directly, rather than asking git, spares a process on every status refresh.
    pub fn find(root: &str) -> Result<Option<Self>, VcsError> {
        let folder = canonical_folder(root)?;
        let top = folder
            .ancestors()
            .find(|dir| dir.join(GIT_ENTRY).exists())
            .map(Path::to_path_buf);
        Ok(top.map(|top| Self {
            git: Git::new(&top),
            top,
        }))
    }

    pub fn open(root: &str) -> Result<Self, VcsError> {
        Self::find(root)?.ok_or_else(|| VcsError::NotARepository(root.to_owned()))
    }

    pub fn top(&self) -> &Path {
        &self.top
    }

    /// For commands that only look. An optional lock is the index refresh `git status` and
    /// `git diff` do on the side; skipping it keeps polling from colliding with the user's own git.
    pub fn read<I, S>(&self, args: I) -> Invocation<'_>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        self.git.command(args).env(NO_OPTIONAL_LOCKS_ENV, "0")
    }

    pub fn write<I, S>(&self, args: I) -> Invocation<'_>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        self.git.command(args)
    }

    /// False in a repository that has no commit yet.
    pub fn head_exists(&self) -> Result<bool, VcsError> {
        let output = self
            .read(["rev-parse", "--verify", "--quiet", "HEAD"])
            .run_unchecked()?;
        match output.code {
            0 => Ok(true),
            1 => Ok(false),
            _ => Err(output.into_error().into()),
        }
    }

    /// The branch HEAD is on, which exists even before its first commit; `None` when detached.
    pub fn current_branch(&self) -> Result<Option<String>, VcsError> {
        let output = self
            .read(["symbolic-ref", "--short", "--quiet", "HEAD"])
            .run_unchecked()?;
        match output.code {
            0 => Ok(Some(output.text()?)),
            1 => Ok(None),
            _ => Err(output.into_error().into()),
        }
    }

    pub fn require_branch(&self) -> Result<String, VcsError> {
        self.current_branch()?.ok_or(VcsError::DetachedHead)
    }

    pub fn remotes(&self) -> Result<Vec<String>, VcsError> {
        let output = self.read(["remote"]).run()?;
        Ok(output.text()?.lines().map(str::to_owned).collect())
    }

    /// Whether a local branch is set up to track a remote branch. Read from the configuration,
    /// so it holds even when the remote branch has not been fetched or no longer exists.
    pub fn has_upstream(&self, branch: &str) -> Result<bool, VcsError> {
        let key = format!("branch.{branch}.merge");
        let configured = self.read(["config", "--get", &key]).run_unchecked()?;
        match configured.code {
            0 => Ok(true),
            1 => Ok(false),
            _ => Err(configured.into_error().into()),
        }
    }
}

fn canonical_folder(root: &str) -> Result<PathBuf, VcsError> {
    let path = dunce::canonicalize(root).map_err(|error| VcsError::io(Path::new(root), error))?;
    if path.is_dir() {
        Ok(path)
    } else {
        Err(VcsError::NotAFolder(path.display().to_string()))
    }
}
