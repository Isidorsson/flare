//! `git status --porcelain=v2 -z --branch`, parsed. With `-z` every record ends in a NUL and
//! nothing is quoted, so any file name survives; a rename carries its old name as one more record.

use super::error::VcsError;
use super::model::{Change, VcsFile, VcsStatus};
use super::repo::Repo;

const SHORT_SHA_LEN: usize = 7;
const COMMAND: &str = "status";

pub fn read(repo: &Repo) -> Result<VcsStatus, VcsError> {
    let output = repo
        .read([
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "--untracked-files=all",
        ])
        .run()?;
    parse(&output.stdout)
}

pub fn parse(stdout: &[u8]) -> Result<VcsStatus, VcsError> {
    let mut status = VcsStatus {
        is_repo: true,
        ..VcsStatus::not_a_repo()
    };
    let mut records = stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        let line = text(record)?;
        if let Some(header) = line.strip_prefix("# ") {
            apply_header(&mut status, header)?;
            continue;
        }
        let (kind, rest) = line
            .split_once(' ')
            .ok_or_else(|| malformed("entry", line))?;
        match kind {
            "1" => status.files.push(ordinary(rest)?),
            "2" => {
                let original = records
                    .next()
                    .ok_or_else(|| malformed("rename without its old name", line))?;
                status.files.push(renamed(rest, text(original)?)?);
            }
            "u" => status.files.push(unmerged(rest)?),
            "?" => status.files.push(untracked(rest)),
            "!" => {}
            _ => return Err(malformed("entry", line)),
        }
    }
    status.files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(status)
}

/// Headers git adds in newer versions (`# stash`, ...) are skipped rather than rejected.
fn apply_header(status: &mut VcsStatus, header: &str) -> Result<(), VcsError> {
    let Some((key, value)) = header.split_once(' ') else {
        return Ok(());
    };
    match key {
        "branch.oid" => {
            status.head =
                (value != "(initial)").then(|| value.chars().take(SHORT_SHA_LEN).collect());
        }
        "branch.head" => status.branch = (value != "(detached)").then(|| value.to_owned()),
        "branch.upstream" => status.upstream = Some(value.to_owned()),
        "branch.ab" => (status.ahead, status.behind) = ahead_behind(value)?,
        _ => {}
    }
    Ok(())
}

fn ahead_behind(value: &str) -> Result<(u32, u32), VcsError> {
    let count = |part: Option<&str>, sign: char| {
        part.and_then(|part| part.strip_prefix(sign))
            .and_then(|digits| digits.parse::<u32>().ok())
            .ok_or_else(|| malformed("branch.ab", value))
    };
    let mut parts = value.split(' ');
    let ahead = count(parts.next(), '+')?;
    let behind = count(parts.next(), '-')?;
    Ok((ahead, behind))
}

fn ordinary(rest: &str) -> Result<VcsFile, VcsError> {
    let [xy, _sub, _mh, _mi, _mw, _hh, _hi, path] = fields(rest, "1")?;
    let (staged, unstaged) = changes(xy)?;
    Ok(file(path, None, staged, unstaged))
}

fn renamed(rest: &str, original: &str) -> Result<VcsFile, VcsError> {
    let [xy, _sub, _mh, _mi, _mw, _hh, _hi, _score, path] = fields(rest, "2")?;
    let (staged, unstaged) = changes(xy)?;
    Ok(file(path, Some(original), staged, unstaged))
}

/// Both sides of a conflict are in the working tree, so it is listed with the unstaged changes:
/// staging it (after resolving) is what moves it to the staged list.
fn unmerged(rest: &str) -> Result<VcsFile, VcsError> {
    let [_xy, _sub, _m1, _m2, _m3, _mw, _h1, _h2, _h3, path] = fields(rest, "u")?;
    Ok(file(path, None, None, Some(Change::Conflicted)))
}

fn untracked(path: &str) -> VcsFile {
    file(path, None, None, Some(Change::Untracked))
}

fn file(
    path: &str,
    original: Option<&str>,
    staged: Option<Change>,
    unstaged: Option<Change>,
) -> VcsFile {
    VcsFile {
        path: path.to_owned(),
        orig_path: original.map(str::to_owned),
        staged,
        unstaged,
    }
}

fn changes(xy: &str) -> Result<(Option<Change>, Option<Change>), VcsError> {
    let mut chars = xy.chars();
    match (chars.next(), chars.next(), chars.next()) {
        (Some(staged), Some(unstaged), None) => Ok((change(staged)?, change(unstaged)?)),
        _ => Err(malformed("status code", xy)),
    }
}

fn change(code: char) -> Result<Option<Change>, VcsError> {
    Ok(Some(match code {
        '.' => return Ok(None),
        'M' => Change::Modified,
        'T' => Change::TypeChanged,
        'A' => Change::Added,
        'D' => Change::Deleted,
        'R' | 'C' => Change::Renamed,
        _ => return Err(malformed("status code", &code.to_string())),
    }))
}

/// The leading fields of an entry, with the last one holding the rest (the path may contain spaces).
fn fields<'a, const N: usize>(rest: &'a str, kind: &str) -> Result<[&'a str; N], VcsError> {
    let mut parts = rest.splitn(N, ' ');
    let mut slots = [""; N];
    for slot in &mut slots {
        *slot = parts.next().ok_or_else(|| malformed(kind, rest))?;
    }
    Ok(slots)
}

fn text(record: &[u8]) -> Result<&str, VcsError> {
    std::str::from_utf8(record).map_err(|error| {
        VcsError::output(
            COMMAND,
            format!("a path is not valid UTF-8 ({error}); rename it to show it here"),
        )
    })
}

fn malformed(what: &str, line: &str) -> VcsError {
    VcsError::output(COMMAND, format!("could not read {what}: {line:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const OID: &str = "ce25eb62b449bd86d44285e4f430829c98f48420";
    const BLOB: &str = "f719efd430d52bcfc8566a43b2eb655688d38871";

    fn records(lines: &[&str]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for line in lines {
            bytes.extend_from_slice(line.as_bytes());
            bytes.push(0);
        }
        bytes
    }

    fn entry(xy: &str, path: &str) -> String {
        format!("1 {xy} N... 100644 100644 100644 {BLOB} {BLOB} {path}")
    }

    fn parsed(lines: &[&str]) -> VcsStatus {
        parse(&records(lines)).expect("parses")
    }

    #[test]
    fn reads_the_branch_headers() {
        let status = parsed(&[
            &format!("# branch.oid {OID}"),
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +3 -12",
        ]);
        assert!(status.is_repo);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.head.as_deref(), Some("ce25eb6"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!((status.ahead, status.behind), (3, 12));
        assert!(status.files.is_empty());
    }

    #[test]
    fn a_branch_without_an_upstream_has_no_counts() {
        let status = parsed(&[&format!("# branch.oid {OID}"), "# branch.head topic"]);
        assert_eq!(status.upstream, None);
        assert_eq!((status.ahead, status.behind), (0, 0));
    }

    #[test]
    fn an_unborn_branch_has_no_head() {
        let status = parsed(&["# branch.oid (initial)", "# branch.head main"]);
        assert_eq!(status.head, None);
        assert_eq!(status.branch.as_deref(), Some("main"));
    }

    #[test]
    fn a_detached_head_has_no_branch() {
        let status = parsed(&[&format!("# branch.oid {OID}"), "# branch.head (detached)"]);
        assert_eq!(status.branch, None);
        assert_eq!(status.head.as_deref(), Some("ce25eb6"));
    }

    #[test]
    fn splits_staged_and_unstaged_changes() {
        let status = parsed(&[
            &entry("M.", "staged.txt"),
            &entry(".M", "unstaged.txt"),
            &entry("MM", "both.txt"),
            &entry("A.", "added.txt"),
            &entry(".D", "gone.txt"),
            &entry("T.", "retyped.txt"),
        ]);
        let by_path = |path: &str| {
            let file = status.files.iter().find(|file| file.path == path);
            let file = file.expect("listed");
            (file.staged, file.unstaged)
        };
        assert_eq!(by_path("staged.txt"), (Some(Change::Modified), None));
        assert_eq!(by_path("unstaged.txt"), (None, Some(Change::Modified)));
        assert_eq!(
            by_path("both.txt"),
            (Some(Change::Modified), Some(Change::Modified))
        );
        assert_eq!(by_path("added.txt"), (Some(Change::Added), None));
        assert_eq!(by_path("gone.txt"), (None, Some(Change::Deleted)));
        assert_eq!(by_path("retyped.txt"), (Some(Change::TypeChanged), None));
    }

    #[test]
    fn a_rename_takes_its_old_name_from_the_next_record() {
        let rename = format!("2 RM N... 100644 100644 100644 {BLOB} {BLOB} R100 new name.txt");
        let status = parsed(&[&rename, "old name.txt", &entry("M.", "z.txt")]);
        assert_eq!(status.files.len(), 2);
        let moved = &status.files[0];
        assert_eq!(moved.path, "new name.txt");
        assert_eq!(moved.orig_path.as_deref(), Some("old name.txt"));
        assert_eq!(moved.staged, Some(Change::Renamed));
        assert_eq!(moved.unstaged, Some(Change::Modified));
        assert_eq!(status.files[1].path, "z.txt");
    }

    #[test]
    fn a_rename_missing_its_old_name_is_an_error() {
        let rename = format!("2 R. N... 100644 100644 100644 {BLOB} {BLOB} R100 new.txt");
        let error = parse(&records(&[&rename])).expect_err("incomplete");
        assert_eq!(error.code(), "output");
    }

    #[test]
    fn untracked_files_are_unstaged_only_and_ignored_ones_are_skipped() {
        let status = parsed(&["? notes.md", "! target/", "? dir/sub file.txt"]);
        assert_eq!(status.files.len(), 2);
        for file in &status.files {
            assert_eq!(file.staged, None);
            assert_eq!(file.unstaged, Some(Change::Untracked));
            assert_eq!(file.orig_path, None);
        }
        assert_eq!(status.files[0].path, "dir/sub file.txt");
    }

    #[test]
    fn conflicts_are_listed_as_unstaged_only() {
        let conflict =
            format!("u UU N... 100644 100644 100644 100644 {BLOB} {BLOB} {BLOB} both edited.txt");
        let status = parsed(&[&conflict]);
        let file = &status.files[0];
        assert_eq!(file.path, "both edited.txt");
        assert_eq!(file.staged, None);
        assert_eq!(file.unstaged, Some(Change::Conflicted));
    }

    #[test]
    fn paths_keep_spaces_and_non_ascii_characters() {
        let status = parsed(&[&entry(".M", "dir with space/ü ñ 日本.txt")]);
        assert_eq!(status.files[0].path, "dir with space/ü ñ 日本.txt");
    }

    #[test]
    fn files_are_sorted_by_path_with_untracked_among_the_rest() {
        let status = parsed(&["? b.txt", &entry(".M", "c.txt"), &entry(".M", "a.txt")]);
        let paths: Vec<&str> = status.files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, ["a.txt", "b.txt", "c.txt"]);
    }

    #[test]
    fn unknown_headers_are_skipped() {
        let status = parsed(&["# stash 2", "# branch.head main"]);
        assert_eq!(status.branch.as_deref(), Some("main"));
    }

    #[test]
    fn garbage_is_an_error_not_an_empty_status() {
        for bad in [
            "9 what",
            "1 M.",
            "1 XX N... a a a a a p",
            "# branch.ab +x -1",
        ] {
            let result = parse(&records(&[bad]));
            assert!(result.is_err(), "{bad}");
        }
    }

    #[test]
    fn a_path_that_is_not_utf8_is_reported() {
        let mut bytes = b"? ".to_vec();
        bytes.extend_from_slice(&[0xff, 0xfe]);
        bytes.push(0);
        let error = parse(&bytes).expect_err("not UTF-8");
        assert!(error.to_string().contains("UTF-8"));
    }

    #[test]
    fn empty_output_is_a_clean_repository() {
        let status = parse(b"").expect("parses");
        assert!(status.is_repo);
        assert!(status.files.is_empty());
    }
}
