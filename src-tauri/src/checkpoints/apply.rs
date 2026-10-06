//! Puts files back. Only the planned paths are touched: files to remove are deleted here, files to
//! write are checked out of a scratch index holding the target tree, and nothing else in the
//! workspace (or in the user's own index) is read for writing.

use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

use super::error::CheckpointError;
use super::git::INDEX_FILE_ENV;
use super::index::ScratchIndex;
use super::model::{FileAction, PlannedFile};
use super::workspace::Workspace;

const GIT_ENTRY: &str = ".git";

/// Applies `files`, which describe how to reach `target_tree`. Returns non-fatal warnings.
pub fn apply(
    workspace: &Workspace,
    target_tree: &str,
    files: &[PlannedFile],
) -> Result<Vec<String>, CheckpointError> {
    let root = workspace.root();
    let mut deletes = Vec::new();
    let mut writes = Vec::new();
    for file in files {
        let path = validated(&file.path)?;
        match file.action {
            FileAction::Delete => deletes.push(path),
            FileAction::Revert | FileAction::Recreate => writes.push(path),
        }
    }
    for path in &deletes {
        remove_file(root, path)?;
    }
    let warnings = prune_empty_folders(root, &deletes);
    write_files(workspace, target_tree, &writes)?;
    Ok(warnings)
}

/// Paths come from git, but a restore deletes files, so one that could leave the workspace or
/// reach into `.git` is refused before anything is touched.
fn validated(path: &str) -> Result<PathBuf, CheckpointError> {
    let candidate = PathBuf::from(path);
    let mut components = candidate.components().peekable();
    let plain = components.peek().is_some()
        && components.all(|part| matches!(part, Component::Normal(name) if name != GIT_ENTRY));
    if plain && !path.contains('\0') {
        Ok(candidate)
    } else {
        Err(CheckpointError::InvalidRequest(format!(
            "refusing to restore the path {path:?}"
        )))
    }
}

fn remove_file(root: &Path, relative: &Path) -> Result<(), CheckpointError> {
    let path = root.join(relative);
    if !is_inside(root, &path)? {
        return Err(CheckpointError::InvalidRequest(format!(
            "{} resolves outside the workspace",
            relative.display()
        )));
    }
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_dir() => Err(CheckpointError::InvalidRequest(format!(
            "{} is a folder now, so it was not deleted",
            relative.display()
        ))),
        Ok(_) => delete(&path),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CheckpointError::io(&path, error)),
    }
}

/// A symlinked parent folder must not carry a delete out of the workspace.
fn is_inside(root: &Path, path: &Path) -> Result<bool, CheckpointError> {
    let Some(parent) = path.parent() else {
        return Ok(false);
    };
    match dunce::canonicalize(parent) {
        Ok(real) => Ok(real.starts_with(root)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(true),
        Err(error) => Err(CheckpointError::io(parent, error)),
    }
}

fn delete(path: &Path) -> Result<(), CheckpointError> {
    match fs::remove_file(path) {
        Err(error) if error.kind() == ErrorKind::PermissionDenied => clear_read_only(path),
        other => other.map_err(|error| CheckpointError::io(path, error)),
    }
}

fn clear_read_only(path: &Path) -> Result<(), CheckpointError> {
    let metadata = fs::metadata(path).map_err(|error| CheckpointError::io(path, error))?;
    let mut permissions = metadata.permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    fs::set_permissions(path, permissions).map_err(|error| CheckpointError::io(path, error))?;
    fs::remove_file(path).map_err(|error| CheckpointError::io(path, error))
}

/// Removes the folders that deleting those files left empty. A folder that is in use or not
/// empty stays, which only costs tidiness, so it is reported instead of failing the restore.
fn prune_empty_folders(root: &Path, deleted: &[PathBuf]) -> Vec<String> {
    let mut warnings = Vec::new();
    for relative in deleted {
        let mut folder = root.join(relative);
        while folder.pop() && folder != root && folder.starts_with(root) {
            match fs::remove_dir(&folder) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) if error.kind() == ErrorKind::DirectoryNotEmpty => break,
                Err(error) => {
                    warnings.push(format!("could not remove {}: {error}", folder.display()));
                    break;
                }
            }
        }
    }
    warnings
}

fn write_files(
    workspace: &Workspace,
    target_tree: &str,
    paths: &[PathBuf],
) -> Result<(), CheckpointError> {
    if paths.is_empty() {
        return Ok(());
    }
    let scratch = ScratchIndex::empty()?;
    workspace
        .git()
        .command(["read-tree", target_tree])
        .env(INDEX_FILE_ENV, scratch.path())
        .run()?;
    let mut input = Vec::new();
    for path in paths {
        input.extend_from_slice(path.to_string_lossy().replace('\\', "/").as_bytes());
        input.push(0);
    }
    workspace
        .git()
        .command(["checkout-index", "-f", "-z", "--stdin"])
        .env(INDEX_FILE_ENV, scratch.path())
        .stdin(input)
        .run()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_relative_paths_are_accepted() {
        assert!(validated("src/main.rs").is_ok());
        assert!(validated("a b/c d.txt").is_ok());
        assert!(validated(".gitignore").is_ok());
    }

    #[test]
    fn paths_that_could_escape_or_reach_git_internals_are_refused() {
        for bad in [
            "",
            "../x",
            "a/../../x",
            "./x",
            "/etc/passwd",
            ".git/config",
            "sub/.git/hooks/pre-commit",
            "a\0b",
        ] {
            assert!(validated(bad).is_err(), "{bad:?}");
        }
        if cfg!(windows) {
            assert!(validated("C:/x").is_err());
            assert!(validated("C:\\x").is_err());
        }
    }

    #[test]
    fn only_empty_folders_are_pruned_and_never_the_root() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        fs::create_dir_all(root.join("a/b/c")).expect("tree");
        fs::create_dir_all(root.join("keep")).expect("keep");
        fs::write(root.join("a/sibling.txt"), "x").expect("sibling");
        fs::write(root.join("keep/file.txt"), "x").expect("file");

        let deleted = [
            PathBuf::from("a/b/c/gone.txt"),
            PathBuf::from("keep/gone.txt"),
        ];
        let warnings = prune_empty_folders(&root, &deleted);

        assert!(warnings.is_empty(), "{warnings:?}");
        assert!(!root.join("a/b").exists(), "empty chain removed");
        assert!(root.join("a").exists(), "a folder with a sibling stays");
        assert!(root.join("keep").exists());
        assert!(root.exists());
    }

    #[test]
    fn deleting_a_missing_file_is_not_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        remove_file(&root, Path::new("nope/never.txt")).expect("already gone");
    }

    #[test]
    fn a_folder_is_never_deleted_as_if_it_were_a_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        fs::create_dir_all(root.join("now-a-folder")).expect("folder");
        let error = remove_file(&root, Path::new("now-a-folder")).expect_err("folder");
        assert_eq!(error.code(), "invalid_request");
        assert!(root.join("now-a-folder").exists());
    }

    #[test]
    fn read_only_files_can_still_be_deleted() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        let file = root.join("locked.txt");
        fs::write(&file, "x").expect("write");
        let mut permissions = fs::metadata(&file).expect("meta").permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&file, permissions).expect("read-only");
        remove_file(&root, Path::new("locked.txt")).expect("deleted");
        assert!(!file.exists());
    }
}
