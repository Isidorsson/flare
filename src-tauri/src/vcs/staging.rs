//! Moves changes between the working tree, the index and HEAD, only for the files asked for.

use super::error::VcsError;
use super::paths;
use super::repo::Repo;

/// Stages additions, edits and deletions. No paths means everything.
pub fn stage(repo: &Repo, files: &[String]) -> Result<(), VcsError> {
    if files.is_empty() {
        repo.write(["add", "-A"]).run()?;
        return Ok(());
    }
    run_for_paths(repo, &["add", "-A", "--"], files)
}

/// Puts the index back to HEAD for the files, leaving the working tree alone. No paths means
/// everything. `reset` is used because it also works before the first commit, where
/// `restore --staged` has no HEAD to restore from.
pub fn unstage(repo: &Repo, files: &[String]) -> Result<(), VcsError> {
    if files.is_empty() {
        repo.write(["reset", "-q"]).run()?;
        return Ok(());
    }
    run_for_paths(repo, &["reset", "-q", "--"], files)
}

/// Overwrites the working copy of tracked files with what the index holds. Throws the edits away
/// for good, so an empty list is refused rather than read as "everything".
pub fn discard(repo: &Repo, files: &[String]) -> Result<(), VcsError> {
    if files.is_empty() {
        return Err(VcsError::InvalidRequest(
            "name the files to discard; an empty list is not read as every file".to_owned(),
        ));
    }
    run_for_paths(repo, &["restore", "--worktree", "--"], files)
}

fn run_for_paths(repo: &Repo, base: &[&str], files: &[String]) -> Result<(), VcsError> {
    for chunk in paths::chunks(files) {
        let args = base.iter().copied().chain(chunk.iter().map(String::as_str));
        repo.write(args).run()?;
    }
    Ok(())
}
