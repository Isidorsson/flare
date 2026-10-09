//! Takes a snapshot of the working tree without touching the user's index, HEAD, branches, stash
//! or files.
//!
//! The working tree is staged into a copy of the index (see `index.rs`) with `git add -A`, which
//! honours every `.gitignore`, then `git write-tree` turns that copy into a tree object. The only
//! things written to the repository are objects (blobs, trees, one commit) and, in `service.rs`,
//! a ref under `refs/flare/`. Files are filtered the way git normally treats them (line endings,
//! `.gitattributes`), as `git stash` does, so a restored file follows the user's git settings.

use super::error::CheckpointError;
use super::index::{on_index, ScratchIndex};
use super::model::StoreKind;
use super::workspace::Workspace;
use crate::git_cli::{Git, Output};

const AUTHOR_NAME: &str = "Flare";
const AUTHOR_EMAIL: &str = "flare@localhost";
const WARNING_LIMIT: usize = 10;
/// With `--ignore-errors`, git exits 1 when it skipped files it could not read.
const SKIPPED_FILES_EXIT: i32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeSnapshot {
    pub tree: String,
    /// Files git could not read (locked by another program, permissions); they keep their old
    /// state in the snapshot.
    pub warnings: Vec<String>,
}

pub fn snapshot_tree(workspace: &Workspace) -> Result<TreeSnapshot, CheckpointError> {
    let scratch = match workspace.kind() {
        StoreKind::Git => Some(ScratchIndex::copy_of(workspace.index_path())?),
        StoreKind::Private => None,
    };
    let git = workspace.git();
    let added = on_index(
        git.command(["add", "-A", "--ignore-errors", "--", "."]),
        scratch.as_ref(),
    )
    .run_unchecked()?;
    let warnings = skipped_files(added)?;
    let tree = on_index(git.command(["write-tree"]), scratch.as_ref())
        .run()?
        .text()?;
    Ok(TreeSnapshot { tree, warnings })
}

/// A parentless commit, so that removing the ref frees the objects it alone kept alive.
pub fn commit_tree(
    git: &Git,
    tree: &str,
    message: &str,
    at: i64,
) -> Result<String, CheckpointError> {
    let date = format!("{at} +0000");
    git.command(["commit-tree", tree, "-m", message, "--no-gpg-sign"])
        .env("GIT_AUTHOR_NAME", AUTHOR_NAME)
        .env("GIT_AUTHOR_EMAIL", AUTHOR_EMAIL)
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_NAME", AUTHOR_NAME)
        .env("GIT_COMMITTER_EMAIL", AUTHOR_EMAIL)
        .env("GIT_COMMITTER_DATE", &date)
        .run()?
        .text()
        .map_err(CheckpointError::from)
}

fn skipped_files(added: Output) -> Result<Vec<String>, CheckpointError> {
    match added.code {
        0 => Ok(Vec::new()),
        SKIPPED_FILES_EXIT => Ok(error_lines(&added.stderr)),
        _ => Err(added.into_error().into()),
    }
}

fn error_lines(stderr: &str) -> Vec<String> {
    let lines: Vec<String> = stderr
        .lines()
        .filter_map(|line| line.strip_prefix("error: "))
        .take(WARNING_LIMIT)
        .map(str::to_owned)
        .collect();
    if lines.is_empty() {
        vec![stderr.to_owned()]
    } else {
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_error_lines_are_reported_as_skipped_files() {
        let stderr = "warning: LF will be replaced by CRLF\nerror: open(\"a.db\"): Permission denied\nerror: unable to index file 'a.db'\nfatal: adding files failed";
        assert_eq!(
            error_lines(stderr),
            [
                "open(\"a.db\"): Permission denied",
                "unable to index file 'a.db'"
            ]
        );
    }

    #[test]
    fn unrecognised_failures_keep_the_whole_message() {
        assert_eq!(error_lines("something odd"), ["something odd"]);
    }

    #[test]
    fn warnings_are_capped() {
        let stderr: String = (0..30).map(|n| format!("error: file {n}\n")).collect();
        assert_eq!(error_lines(&stderr).len(), WARNING_LIMIT);
    }
}
