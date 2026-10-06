//! Differences between two trees, read from `git diff-tree`.
//!
//! One run asks for `--raw` (modes and blob ids, to compare file states exactly) together with
//! `--numstat` (line counts). With `-z` git prints every raw record first and then every numstat
//! record, so the two are matched up by path. `--relative` limits the answer to the workspace
//! folder and makes the paths relative to it, which is what the rest of the module works in.

use std::collections::HashMap;

use super::error::CheckpointError;
use super::git::Git;
use super::model::{FileDelta, FileStatus};

const GITLINK_MODE: &str = "160000";
const ABSENT_MODE: &str = "000000";
const COMMAND: &str = "diff-tree";

/// One side of a change: how a file looked in a tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blob {
    pub mode: String,
    pub oid: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Counts {
    Lines { added: u32, removed: u32 },
    Binary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub path: String,
    pub old: Option<Blob>,
    pub new: Option<Blob>,
    pub counts: Option<Counts>,
}

impl Change {
    pub fn status(&self) -> FileStatus {
        match (&self.old, &self.new) {
            (None, _) => FileStatus::Added,
            (_, None) => FileStatus::Deleted,
            _ => FileStatus::Modified,
        }
    }

    pub fn to_delta(&self) -> FileDelta {
        let (added, removed) = match self.counts {
            Some(Counts::Lines { added, removed }) => (Some(added), Some(removed)),
            Some(Counts::Binary) | None => (None, None),
        };
        FileDelta {
            path: self.path.clone(),
            status: self.status(),
            added,
            removed,
        }
    }
}

/// Every file that differs between the two trees, inside the workspace folder, sorted by path.
pub fn tree_diff(git: &Git, from: &str, to: &str) -> Result<Vec<Change>, CheckpointError> {
    let output = git
        .command([
            COMMAND,
            "-r",
            "-z",
            "--raw",
            "--numstat",
            "--no-renames",
            "--relative",
            from,
            to,
        ])
        .run()?;
    parse_raw_numstat(&output.stdout)
}

/// Only the paths that differ, for callers that compare nothing else.
pub fn changed_paths(git: &Git, from: &str, to: &str) -> Result<Vec<String>, CheckpointError> {
    let output = git
        .command([
            COMMAND,
            "-r",
            "-z",
            "--name-only",
            "--no-renames",
            "--relative",
            from,
            to,
        ])
        .run()?;
    let text = utf8(&output.stdout)?;
    Ok(text
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .collect())
}

pub fn parse_raw_numstat(bytes: &[u8]) -> Result<Vec<Change>, CheckpointError> {
    let mut tokens = utf8(bytes)?.split('\0');
    let mut changes = Vec::new();
    let mut counts: HashMap<&str, Counts> = HashMap::new();
    while let Some(token) = tokens.next() {
        if token.is_empty() {
            continue;
        }
        if let Some(record) = token.strip_prefix(':') {
            let path = tokens
                .next()
                .filter(|path| !path.is_empty())
                .ok_or_else(|| malformed(&format!("no path after {token:?}")))?;
            changes.extend(parse_raw(record, path)?);
        } else {
            let (path, count) = parse_numstat(token)?;
            counts.insert(path, count);
        }
    }
    for change in &mut changes {
        change.counts = counts.get(change.path.as_str()).copied();
    }
    Ok(changes)
}

/// A submodule or nested repository is a single commit id to git, not a file Flare can restore.
fn parse_raw(record: &str, path: &str) -> Result<Option<Change>, CheckpointError> {
    let fields: Vec<&str> = record.split(' ').collect();
    let [old_mode, new_mode, old_oid, new_oid, _status] = fields[..] else {
        return Err(malformed(&format!("unreadable record {record:?}")));
    };
    if old_mode == GITLINK_MODE || new_mode == GITLINK_MODE {
        return Ok(None);
    }
    Ok(Some(Change {
        path: path.to_owned(),
        old: blob(old_mode, old_oid),
        new: blob(new_mode, new_oid),
        counts: None,
    }))
}

fn blob(mode: &str, oid: &str) -> Option<Blob> {
    (mode != ABSENT_MODE).then(|| Blob {
        mode: mode.to_owned(),
        oid: oid.to_owned(),
    })
}

fn parse_numstat(token: &str) -> Result<(&str, Counts), CheckpointError> {
    let mut parts = token.splitn(3, '\t');
    let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next())
    else {
        return Err(malformed(&format!("unreadable count {token:?}")));
    };
    if added == "-" && removed == "-" {
        return Ok((path, Counts::Binary));
    }
    let count = |text: &str| {
        text.parse::<u32>()
            .map_err(|_| malformed(&format!("unreadable count {token:?}")))
    };
    Ok((
        path,
        Counts::Lines {
            added: count(added)?,
            removed: count(removed)?,
        },
    ))
}

fn utf8(bytes: &[u8]) -> Result<&str, CheckpointError> {
    std::str::from_utf8(bytes).map_err(|error| malformed(&error.to_string()))
}

fn malformed(detail: &str) -> CheckpointError {
    CheckpointError::Output {
        command: COMMAND.to_owned(),
        detail: detail.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZERO: &str = "0000000000000000000000000000000000000000";

    fn raw(
        old_mode: &str,
        new_mode: &str,
        old: &str,
        new: &str,
        status: &str,
        path: &str,
    ) -> String {
        format!(":{old_mode} {new_mode} {old} {new} {status}\0{path}\0")
    }

    #[test]
    fn parses_modified_added_and_deleted_files_with_counts() {
        let text = [
            raw("100644", "100644", "aaa", "bbb", "M", "a.txt"),
            raw("000000", "100755", ZERO, "ccc", "A", "dir/new.sh"),
            raw("100644", "000000", "ddd", ZERO, "D", "gone.txt"),
            "1\t2\ta.txt\0".to_owned(),
            "5\t0\tdir/new.sh\0".to_owned(),
            "0\t7\tgone.txt\0".to_owned(),
        ]
        .concat();
        let changes = parse_raw_numstat(text.as_bytes()).expect("parses");
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].status(), FileStatus::Modified);
        assert_eq!(
            changes[0].counts,
            Some(Counts::Lines {
                added: 1,
                removed: 2
            })
        );
        assert_eq!(changes[1].status(), FileStatus::Added);
        assert_eq!(changes[1].old, None);
        assert_eq!(
            changes[1].new.as_ref().map(|b| b.mode.as_str()),
            Some("100755")
        );
        assert_eq!(changes[2].status(), FileStatus::Deleted);
        assert_eq!(changes[2].new, None);
    }

    #[test]
    fn binary_files_have_no_line_counts() {
        let text = format!(
            "{}-\t-\timg.png\0",
            raw("100644", "100644", "aaa", "bbb", "M", "img.png")
        );
        let changes = parse_raw_numstat(text.as_bytes()).expect("parses");
        assert_eq!(changes[0].counts, Some(Counts::Binary));
        let delta = changes[0].to_delta();
        assert_eq!((delta.added, delta.removed), (None, None));
    }

    #[test]
    fn submodules_are_not_files_and_are_left_out() {
        let text = format!(
            "{}{}1\t1\tvendor/lib\0",
            raw("160000", "160000", "aaa", "bbb", "M", "vendor/lib"),
            raw("100644", "100644", "ccc", "ddd", "M", "kept.txt"),
        );
        let changes = parse_raw_numstat(text.as_bytes()).expect("parses");
        let paths: Vec<_> = changes.iter().map(|c| c.path.as_str()).collect();
        assert_eq!(paths, ["kept.txt"]);
    }

    #[test]
    fn paths_with_tabs_and_spaces_survive() {
        let text = format!(
            "{}1\t0\tweird\tname with space.txt\0",
            raw(
                "000000",
                "100644",
                ZERO,
                "aaa",
                "A",
                "weird\tname with space.txt"
            )
        );
        let changes = parse_raw_numstat(text.as_bytes()).expect("parses");
        assert_eq!(changes[0].path, "weird\tname with space.txt");
        assert_eq!(
            changes[0].counts,
            Some(Counts::Lines {
                added: 1,
                removed: 0
            })
        );
    }

    #[test]
    fn a_type_change_is_a_modification() {
        let text = raw("100644", "120000", "aaa", "bbb", "T", "link");
        let changes = parse_raw_numstat(text.as_bytes()).expect("parses");
        assert_eq!(changes[0].status(), FileStatus::Modified);
        assert_eq!(changes[0].counts, None);
    }

    #[test]
    fn empty_output_is_no_changes() {
        assert!(parse_raw_numstat(b"").expect("parses").is_empty());
    }

    #[test]
    fn malformed_records_are_errors_not_guesses() {
        assert!(parse_raw_numstat(b":100644 100644 aaa M\0a.txt\0").is_err());
        assert!(parse_raw_numstat(b":100644 100644 aaa bbb M\0").is_err());
        assert!(parse_raw_numstat(b"x\ty\tz\0").is_err());
        assert!(parse_raw_numstat(&[0xff, 0xfe]).is_err());
    }
}
