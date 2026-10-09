//! The two texts for the editor's diff view: staged is HEAD against the index, unstaged is the
//! index against the working tree. `None` means that side does not exist (a new or deleted file).

use super::blobs::{read_objects, read_working_file, Blob};
use super::error::VcsError;
use super::model::FileDiff;
use super::paths;
use super::repo::Repo;

const COMMAND: &str = "diff";

pub fn file_diff(repo: &Repo, path: &str, staged: bool) -> Result<FileDiff, VcsError> {
    let path = paths::validate(path)?;
    let (original, modified) = if staged {
        staged_sides(repo, path)?
    } else {
        unstaged_sides(repo, path)?
    };
    Ok(render(path, original, modified))
}

/// A renamed file is compared with the file it was renamed from, which is not the same path.
fn staged_sides(repo: &Repo, path: &str) -> Result<(Blob, Blob), VcsError> {
    let [head, index] = read_objects(repo, [format!("HEAD:{path}"), format!(":0:{path}")])?;
    if head.is_present() || !index.is_present() {
        return Ok((head, index));
    }
    let Some(old_path) = renamed_from(repo, path)? else {
        return Ok((head, index));
    };
    let [old] = read_objects(repo, [format!("HEAD:{old_path}")])?;
    Ok((old, index))
}

/// A conflicted file has no stage-0 entry; its own side (stage 2) is the baseline then.
fn unstaged_sides(repo: &Repo, path: &str) -> Result<(Blob, Blob), VcsError> {
    let stages = read_objects(
        repo,
        [":0:", ":2:", ":3:"].map(|stage| format!("{stage}{path}")),
    )?;
    let original = stages
        .into_iter()
        .find(Blob::is_present)
        .unwrap_or(Blob::Missing);
    Ok((original, read_working_file(repo.top(), path)?))
}

fn renamed_from(repo: &Repo, path: &str) -> Result<Option<String>, VcsError> {
    let output = repo
        .read([
            "diff",
            "--cached",
            "--name-status",
            "-z",
            "-M",
            "--no-ext-diff",
        ])
        .run()?;
    find_rename_source(&output.stdout, path)
}

fn find_rename_source(stdout: &[u8], path: &str) -> Result<Option<String>, VcsError> {
    let mut records = stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    while let Some(code) = records.next() {
        let first = records.next().ok_or_else(truncated)?;
        if !matches!(code.first(), Some(b'R' | b'C')) {
            continue;
        }
        let second = records.next().ok_or_else(truncated)?;
        if second == path.as_bytes() {
            return String::from_utf8(first.to_vec())
                .map(Some)
                .map_err(|_| VcsError::output(COMMAND, "a path is not valid UTF-8"));
        }
    }
    Ok(None)
}

fn truncated() -> VcsError {
    VcsError::output(COMMAND, "the list of changed files ended early")
}

fn render(path: &str, original: Blob, modified: Blob) -> FileDiff {
    let binary = original.is_binary() || modified.is_binary();
    FileDiff {
        path: path.to_owned(),
        original: if binary { None } else { original.into_text() },
        modified: if binary { None } else { modified.into_text() },
        binary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name_status(records: &[&str]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for record in records {
            bytes.extend_from_slice(record.as_bytes());
            bytes.push(0);
        }
        bytes
    }

    #[test]
    fn finds_where_a_staged_rename_came_from() {
        let listing = name_status(&[
            "M",
            "x.txt",
            "R100",
            "old name.txt",
            "new name.txt",
            "A",
            "y",
        ]);
        let found = find_rename_source(&listing, "new name.txt").expect("parses");
        assert_eq!(found.as_deref(), Some("old name.txt"));
    }

    #[test]
    fn a_path_that_was_not_renamed_has_no_source() {
        let listing = name_status(&["R100", "a", "b", "A", "c"]);
        assert_eq!(find_rename_source(&listing, "c").expect("parses"), None);
        assert_eq!(find_rename_source(b"", "c").expect("parses"), None);
    }

    #[test]
    fn a_cut_short_listing_is_an_error() {
        let listing = name_status(&["R100", "a"]);
        assert!(find_rename_source(&listing, "b").is_err());
    }

    #[test]
    fn binary_content_hides_both_texts() {
        let diff = render(
            "logo.png",
            Blob::Bytes(b"\x89PNG\0".to_vec()),
            Blob::Bytes(b"text".to_vec()),
        );
        assert!(diff.binary);
        assert_eq!((diff.original, diff.modified), (None, None));
    }

    #[test]
    fn an_oversized_side_hides_both_texts() {
        let diff = render("big.sql", Blob::Bytes(b"small".to_vec()), Blob::TooLarge);
        assert!(diff.binary);
        assert_eq!(diff.original, None);
    }

    #[test]
    fn a_missing_side_stays_null_and_an_empty_file_is_an_empty_string() {
        let diff = render("e.txt", Blob::Missing, Blob::Bytes(Vec::new()));
        assert!(!diff.binary);
        assert_eq!(diff.original, None);
        assert_eq!(diff.modified.as_deref(), Some(""));
    }
}
