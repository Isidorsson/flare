//! Finds where a workspace's snapshots live.
//!
//! A folder inside a git repository uses that repository: snapshots are commits under a hidden
//! ref namespace, so they cost no extra storage format and `git gc` keeps them reachable. A folder
//! outside any repository still gets undo through a private bare repository under Flare's data
//! directory, driven with `--git-dir/--work-tree`, because those folders are exactly where
//! nothing else can bring a file back. It is only created for folders of a sane size: the first
//! snapshot hashes every file, so a bare `node_modules` tree without a `.gitignore` is refused.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use ignore::WalkBuilder;

use super::error::CheckpointError;
use super::model::StoreKind;
use crate::git_cli::Git;

pub const PRIVATE_REPO_FILE_LIMIT: usize = 20_000;
const GIT_ENTRY: &str = ".git";
const GITDIR_PREFIX: &str = "gitdir:";
const HEAD_FILE: &str = "HEAD";
const INDEX_FILE: &str = "index";
const NAME_LIMIT: usize = 24;
const STAGING_EXTENSION: &str = "staging";
const RAW_ATTRIBUTES: &str = "* -text -filter -ident -working-tree-encoding\n";

#[derive(Debug)]
pub struct Workspace {
    root: PathBuf,
    kind: StoreKind,
    git: Git,
    index_path: PathBuf,
}

impl Workspace {
    pub fn resolve(root: &str, private_repos: &Path) -> Result<Self, CheckpointError> {
        Self::resolve_limited(root, private_repos, PRIVATE_REPO_FILE_LIMIT)
    }

    pub fn resolve_limited(
        root: &str,
        private_repos: &Path,
        file_limit: usize,
    ) -> Result<Self, CheckpointError> {
        let root = canonical_folder(root)?;
        if let Some(entry) = repository_entry(&root) {
            return Self::open_repository(root, &entry);
        }
        let git_dir = private_repos.join(private_repo_name(&root));
        ensure_private_repo(&git_dir, &root, file_limit)?;
        Ok(Self::open_private(root, git_dir))
    }

    /// The folder snapshots are taken of; git commands run with it as their working directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn kind(&self) -> StoreKind {
        self.kind
    }

    pub fn git(&self) -> &Git {
        &self.git
    }

    /// The index a snapshot starts from: the user's own (copied, never written) for a repository,
    /// the private repository's index for a private one, which keeps its stat cache between runs.
    pub fn index_path(&self) -> &Path {
        &self.index_path
    }

    fn open_repository(root: PathBuf, entry: &Path) -> Result<Self, CheckpointError> {
        let index_path = repository_dir(entry)?.join(INDEX_FILE);
        Ok(Self {
            git: Git::new(&root),
            root,
            kind: StoreKind::Git,
            index_path,
        })
    }

    fn open_private(root: PathBuf, git_dir: PathBuf) -> Self {
        let git = Git::new(&root)
            .with_global_args([flag("--git-dir=", &git_dir), flag("--work-tree=", &root)]);
        Self {
            index_path: git_dir.join(INDEX_FILE),
            root,
            kind: StoreKind::Private,
            git,
        }
    }
}

/// The repository that already holds a folder's snapshots, without creating one: for maintenance,
/// which has nothing to do in a folder that never had a snapshot taken.
pub fn existing_store(root: &str, private_repos: &Path) -> Result<Option<Git>, CheckpointError> {
    let root = canonical_folder(root)?;
    if repository_entry(&root).is_some() {
        return Ok(Some(Git::new(root)));
    }
    let git_dir = private_repos.join(private_repo_name(&root));
    Ok(git_dir
        .join(HEAD_FILE)
        .is_file()
        .then(|| private_git(&git_dir)))
}

/// The `.git` entry of the repository a folder belongs to, if any. Looking for it directly, rather
/// than asking git, keeps a folder in a repository from needing a process just to be recognised.
fn repository_entry(root: &Path) -> Option<PathBuf> {
    root.ancestors()
        .map(|dir| dir.join(GIT_ENTRY))
        .find(|entry| entry.exists())
}

/// The directory holding this checkout's index: `.git` itself, or, for a linked worktree or a
/// submodule where `.git` is a file, the directory that file points to.
fn repository_dir(entry: &Path) -> Result<PathBuf, CheckpointError> {
    if entry.is_dir() {
        return Ok(entry.to_path_buf());
    }
    let pointer = fs::read_to_string(entry).map_err(|error| CheckpointError::io(entry, error))?;
    let target = pointer
        .lines()
        .find_map(|line| line.strip_prefix(GITDIR_PREFIX))
        .map(str::trim)
        .filter(|target| !target.is_empty())
        .ok_or_else(|| {
            CheckpointError::NotAFolder(format!(
                "{} is not a git directory pointer",
                entry.display()
            ))
        })?;
    let base = entry.parent().unwrap_or(entry);
    Ok(base.join(target))
}

/// A `Git` that talks to a private bare repository.
pub fn private_git(git_dir: &Path) -> Git {
    Git::new(git_dir).with_global_args([flag("--git-dir=", git_dir)])
}

fn flag(name: &str, path: &Path) -> OsString {
    let mut arg = OsString::from(name);
    arg.push(path);
    arg
}

pub fn private_repo_dirs(private_repos: &Path) -> Result<Vec<PathBuf>, CheckpointError> {
    let entries = match fs::read_dir(private_repos) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(CheckpointError::io(private_repos, error)),
    };
    let mut dirs = Vec::new();
    for entry in entries {
        let path = entry
            .map_err(|error| CheckpointError::io(private_repos, error))?
            .path();
        if path.join(HEAD_FILE).is_file() {
            dirs.push(path);
        }
    }
    dirs.sort();
    Ok(dirs)
}

fn canonical_folder(root: &str) -> Result<PathBuf, CheckpointError> {
    let path =
        dunce::canonicalize(root).map_err(|error| CheckpointError::io(Path::new(root), error))?;
    if path.is_dir() {
        Ok(path)
    } else {
        Err(CheckpointError::NotAFolder(path.display().to_string()))
    }
}

fn ensure_private_repo(
    git_dir: &Path,
    root: &Path,
    file_limit: usize,
) -> Result<(), CheckpointError> {
    if git_dir.join(HEAD_FILE).is_file() {
        return Ok(());
    }
    if exceeds_file_limit(root, file_limit)? {
        return Err(CheckpointError::TooLarge {
            path: root.display().to_string(),
            limit: file_limit,
        });
    }
    let parent = git_dir
        .parent()
        .ok_or_else(|| CheckpointError::NotAFolder(git_dir.display().to_string()))?;
    fs::create_dir_all(parent).map_err(|error| CheckpointError::io(parent, error))?;
    let staging = git_dir.with_extension(STAGING_EXTENSION);
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| CheckpointError::io(&staging, error))?;
    }
    Git::new(parent)
        .command([
            OsString::from("init"),
            "--bare".into(),
            "--quiet".into(),
            staging.as_os_str().to_owned(),
        ])
        .run()?;
    keep_content_exact(&staging)?;
    fs::rename(&staging, git_dir).map_err(|error| CheckpointError::io(git_dir, error))
}

/// A folder with no repository has no git settings of its own to honour, and the point of undo
/// there is to bring back the very bytes that were in a file: no line-ending conversion, no
/// filters. The repository's own `info/attributes` outranks any `.gitattributes` in the folder.
fn keep_content_exact(git_dir: &Path) -> Result<(), CheckpointError> {
    let git = private_git(git_dir);
    for (key, value) in [("core.autocrlf", "false"), ("core.safecrlf", "false")] {
        git.command(["config", key, value]).run()?;
    }
    let info = git_dir.join("info");
    fs::create_dir_all(&info).map_err(|error| CheckpointError::io(&info, error))?;
    let attributes = info.join("attributes");
    fs::write(&attributes, RAW_ATTRIBUTES).map_err(|error| CheckpointError::io(&attributes, error))
}

/// Counts the files git would snapshot, stopping as soon as there are too many to be worth it.
fn exceeds_file_limit(root: &Path, limit: usize) -> Result<bool, CheckpointError> {
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .ignore(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(false)
        .parents(true)
        .require_git(false)
        .follow_links(false)
        .filter_entry(|entry| entry.file_name() != GIT_ENTRY)
        .build();
    let mut files = 0usize;
    for entry in walker {
        let entry =
            entry.map_err(|error| CheckpointError::io(root, std::io::Error::other(error)))?;
        if entry.file_type().is_some_and(|kind| !kind.is_dir()) {
            files += 1;
            if files > limit {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn private_repo_name(root: &Path) -> String {
    let label: String = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .take(NAME_LIMIT)
        .collect();
    format!("{label}-{:016x}", fnv1a(&root.to_string_lossy()))
}

/// A hash that stays the same across Rust releases, so a folder keeps finding its repository.
fn fnv1a(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_repo_names_are_stable_and_distinct_per_folder() {
        let a = private_repo_name(Path::new("C:/work/app"));
        assert_eq!(a, private_repo_name(Path::new("C:/work/app")));
        assert_ne!(a, private_repo_name(Path::new("C:/other/app")));
        assert!(a.starts_with("app-"));
    }

    #[test]
    fn private_repo_names_are_safe_directory_names() {
        let name = private_repo_name(Path::new("/w/we ird:name*with?chars-and-a-very-long-tail"));
        assert!(name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert!(name.len() <= NAME_LIMIT + 17);
    }

    #[test]
    fn the_hash_is_pinned_so_repositories_are_found_again() {
        assert_eq!(fnv1a(""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a("a"), 0xaf63_dc4c_8601_ec8c);
    }

    #[test]
    fn a_git_directory_entry_is_its_own_repository_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join(".git")).expect("git dir");
        let found = repository_dir(&dir.path().join(".git")).expect("directory");
        assert_eq!(found, dir.path().join(".git"));
    }

    #[test]
    fn a_git_file_points_at_the_directory_that_holds_the_index() {
        let dir = tempfile::tempdir().expect("tempdir");
        let entry = dir.path().join(".git");
        fs::write(
            &entry,
            "gitdir: ../main/.git/worktrees/linked
",
        )
        .expect("pointer");
        assert_eq!(
            repository_dir(&entry).expect("relative pointer"),
            dir.path().join("../main/.git/worktrees/linked")
        );
        let absolute = dir.path().join("elsewhere");
        fs::write(
            &entry,
            format!(
                "gitdir: {}
",
                absolute.display()
            ),
        )
        .expect("pointer");
        assert_eq!(repository_dir(&entry).expect("absolute pointer"), absolute);
    }

    #[test]
    fn a_git_file_without_a_pointer_is_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let entry = dir.path().join(".git");
        fs::write(
            &entry,
            "not a pointer
",
        )
        .expect("file");
        assert_eq!(
            repository_dir(&entry).expect_err("no pointer").code(),
            "not_a_folder"
        );
    }

    #[test]
    fn the_repository_entry_is_found_in_a_parent_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join(".git")).expect("git dir");
        fs::create_dir_all(dir.path().join("a/b")).expect("nested");
        assert_eq!(
            repository_entry(&dir.path().join("a/b")),
            Some(dir.path().join(".git"))
        );
    }

    #[test]
    fn a_missing_folder_is_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("nope");
        let error =
            Workspace::resolve(missing.to_str().expect("utf8"), dir.path()).expect_err("missing");
        assert_eq!(error.code(), "io");
    }

    #[test]
    fn a_file_is_not_a_workspace() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("f.txt");
        fs::write(&file, "x").expect("write");
        let error = Workspace::resolve(file.to_str().expect("utf8"), dir.path()).expect_err("file");
        assert_eq!(error.code(), "not_a_folder");
    }

    #[test]
    fn listing_private_repos_ignores_other_entries_and_a_missing_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(private_repo_dirs(&dir.path().join("none"))
            .expect("missing is empty")
            .is_empty());
        fs::create_dir_all(dir.path().join("repo-1")).expect("repo dir");
        fs::write(
            dir.path().join("repo-1").join(HEAD_FILE),
            "ref: refs/heads/main\n",
        )
        .expect("HEAD");
        fs::create_dir_all(dir.path().join("stray")).expect("stray dir");
        fs::write(dir.path().join("file.txt"), "x").expect("file");
        let found = private_repo_dirs(dir.path()).expect("list");
        assert_eq!(found, vec![dir.path().join("repo-1")]);
    }
}
