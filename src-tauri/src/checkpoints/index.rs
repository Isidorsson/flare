use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::error::CheckpointError;
use super::git::{Invocation, INDEX_FILE_ENV};

const SCRATCH_PREFIX: &str = "flare-index-";
const SCRATCH_FILE: &str = "index";

/// A throwaway git index in its own temporary directory, removed when dropped. Pointing
/// `GIT_INDEX_FILE` at it lets `git add -A` and `git write-tree` work on a copy, so the user's
/// real index is never opened for writing.
#[derive(Debug)]
pub struct ScratchIndex {
    dir: TempDir,
}

impl ScratchIndex {
    pub fn empty() -> Result<Self, CheckpointError> {
        let dir = tempfile::Builder::new()
            .prefix(SCRATCH_PREFIX)
            .tempdir()
            .map_err(|error| CheckpointError::io(&std::env::temp_dir(), error))?;
        Ok(Self { dir })
    }

    /// A copy of `source`, which has the stat information that lets git skip hashing files that
    /// did not change. A repository that has no index yet starts from an empty one.
    pub fn copy_of(source: &Path) -> Result<Self, CheckpointError> {
        let scratch = Self::empty()?;
        match fs::copy(source, scratch.path()) {
            Ok(_) => Ok(scratch),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(scratch),
            Err(error) => Err(CheckpointError::io(source, error)),
        }
    }

    pub fn path(&self) -> PathBuf {
        self.dir.path().join(SCRATCH_FILE)
    }
}

/// Runs `invocation` against `scratch`, or against the repository's own index when there is none.
pub fn on_index<'a>(invocation: Invocation<'a>, scratch: Option<&ScratchIndex>) -> Invocation<'a> {
    match scratch {
        Some(index) => invocation.env(INDEX_FILE_ENV, index.path()),
        None => invocation,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_an_existing_index_without_touching_the_source() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("index");
        fs::write(&source, b"DIRC-bytes").expect("write");
        let scratch = ScratchIndex::copy_of(&source).expect("copy");
        assert_ne!(scratch.path(), source);
        assert_eq!(fs::read(scratch.path()).expect("read copy"), b"DIRC-bytes");
        fs::write(scratch.path(), b"changed").expect("write copy");
        assert_eq!(fs::read(&source).expect("read source"), b"DIRC-bytes");
    }

    #[test]
    fn a_missing_source_gives_an_empty_scratch_index() {
        let dir = tempfile::tempdir().expect("tempdir");
        let scratch = ScratchIndex::copy_of(&dir.path().join("absent")).expect("copy");
        assert!(!scratch.path().exists());
    }

    #[test]
    fn the_scratch_directory_goes_away_with_the_value() {
        let scratch = ScratchIndex::empty().expect("empty");
        let location = scratch.path();
        let parent = location.parent().expect("parent").to_path_buf();
        assert!(parent.exists());
        drop(scratch);
        assert!(!parent.exists());
    }
}
