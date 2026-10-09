//! What a commit-message generator is shown: the diff about to be committed, cut to a size a model
//! can read, plus recent subjects as a style hint. The size limits are here and nowhere else.

use super::error::VcsError;
use super::model::{DiffSource, MessageContext};
use super::repo::Repo;

/// Bytes of patch text sent in total, markers included.
pub const MESSAGE_PATCH_LIMIT: usize = 48 * 1024;
/// Bytes of patch text kept per file, so one generated file or lockfile cannot use the budget.
pub const MESSAGE_FILE_PATCH_LIMIT: usize = 8 * 1024;
const RECENT_SUBJECT_COUNT: usize = 10;
const STAT_FILE_LIMIT: usize = 60;
const UNTRACKED_LISTED: usize = 50;
/// Room kept for the note that ends a cut file, and again for the note that lists omitted files.
const MARKER_ROOM: usize = 96;
const FILE_HEADER: &str = "diff --git ";

const PLAIN_DIFF: [&str; 2] = ["--no-color", "--no-ext-diff"];

pub fn context(repo: &Repo) -> Result<MessageContext, VcsError> {
    let has_head = repo.head_exists()?;
    let source = if has_staged(repo)? {
        DiffSource::Staged
    } else {
        DiffSource::All
    };
    let (mut stat, patch) = match base_args(source, has_head) {
        Some(base) => (stat_text(repo, &base)?, patch_text(repo, &base)?),
        None => (String::new(), String::new()),
    };
    let untracked_cut = match source {
        DiffSource::All => append_untracked(repo, &mut stat)?,
        DiffSource::Staged => false,
    };
    if stat.trim().is_empty() && patch.trim().is_empty() {
        return Err(VcsError::NothingToDescribe);
    }
    let (patch, patch_cut) = cap_patch(&patch);
    Ok(MessageContext {
        source,
        stat,
        patch,
        truncated: patch_cut || untracked_cut,
        recent_subjects: if has_head {
            recent_subjects(repo)?
        } else {
            Vec::new()
        },
    })
}

/// Staged changes when there are any. Otherwise every change to tracked files since HEAD, which
/// before the first commit is nothing (the untracked files are all there is).
fn base_args(source: DiffSource, has_head: bool) -> Option<Vec<&'static str>> {
    match (source, has_head) {
        (DiffSource::Staged, _) => Some(vec!["diff", "--cached"]),
        (DiffSource::All, true) => Some(vec!["diff", "HEAD"]),
        (DiffSource::All, false) => None,
    }
}

fn has_staged(repo: &Repo) -> Result<bool, VcsError> {
    let output = repo
        .read(["diff", "--cached", "--quiet", "--no-ext-diff"])
        .run_unchecked()?;
    match output.code {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(output.into_error().into()),
    }
}

fn stat_text(repo: &Repo, base: &[&str]) -> Result<String, VcsError> {
    let width = format!("--stat=120,80,{STAT_FILE_LIMIT}");
    let args = base
        .iter()
        .copied()
        .chain(PLAIN_DIFF)
        .chain([width.as_str(), "--summary"]);
    Ok(lossy(&repo.read(args).run()?.stdout))
}

fn patch_text(repo: &Repo, base: &[&str]) -> Result<String, VcsError> {
    let args = base
        .iter()
        .copied()
        .chain(PLAIN_DIFF)
        .chain(["--no-textconv", "--patch"]);
    Ok(lossy(&repo.read(args).run()?.stdout))
}

/// Untracked files have no diff to show, but the message should still know they are new. Returns
/// whether the list was cut.
fn append_untracked(repo: &Repo, stat: &mut String) -> Result<bool, VcsError> {
    let output = repo
        .read(["ls-files", "--others", "--exclude-standard", "-z"])
        .run()?;
    let names: Vec<String> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|name| !name.is_empty())
        .map(lossy)
        .collect();
    if names.is_empty() {
        return Ok(false);
    }
    stat.push_str("\nUntracked files (new, not in the patch):\n");
    for name in names.iter().take(UNTRACKED_LISTED) {
        stat.push_str(&format!("  {name}\n"));
    }
    let more = names.len().saturating_sub(UNTRACKED_LISTED);
    if more > 0 {
        stat.push_str(&format!("  ... and {more} more\n"));
    }
    Ok(more > 0)
}

fn recent_subjects(repo: &Repo) -> Result<Vec<String>, VcsError> {
    let count = RECENT_SUBJECT_COUNT.to_string();
    let output = repo
        .read(["log", "-n", &count, "-z", "--format=%s"])
        .run()?;
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|subject| !subject.is_empty())
        .map(lossy)
        .collect())
}

/// Keeps each file's diff up to its own limit and files in order until the total is used up,
/// saying what was left out. The result never exceeds `MESSAGE_PATCH_LIMIT`.
fn cap_patch(patch: &str) -> (String, bool) {
    let files = split_files(patch);
    let mut kept = String::new();
    let mut truncated = false;
    for (index, file) in files.iter().enumerate() {
        let room = MESSAGE_PATCH_LIMIT - kept.len();
        if room <= MARKER_ROOM * 2 {
            kept.push_str(&format!(
                "[... {} more files omitted ...]\n",
                files.len() - index
            ));
            return (kept, true);
        }
        let allowed = MESSAGE_FILE_PATCH_LIMIT.min(room - MARKER_ROOM * 2);
        let (piece, cut) = cut_at_line(file, allowed);
        kept.push_str(piece);
        if cut {
            let left = file.len() - piece.len();
            kept.push_str(&format!(
                "[... {left} more bytes of this file's diff omitted ...]\n"
            ));
            truncated = true;
        }
    }
    (kept, truncated)
}

/// One slice per file, each starting at its `diff --git` line (which no diff body line can,
/// since those begin with a space, `+`, `-`, `@` or a backslash).
fn split_files(patch: &str) -> Vec<&str> {
    let mut starts: Vec<usize> = patch
        .match_indices(FILE_HEADER)
        .map(|(at, _)| at)
        .filter(|at| *at == 0 || patch.as_bytes()[at - 1] == b'\n')
        .collect();
    let Some(first) = starts.first_mut() else {
        return if patch.is_empty() {
            Vec::new()
        } else {
            vec![patch]
        };
    };
    *first = 0;
    starts.push(patch.len());
    starts
        .windows(2)
        .map(|pair| &patch[pair[0]..pair[1]])
        .collect()
}

fn cut_at_line(text: &str, max: usize) -> (&str, bool) {
    if text.len() <= max {
        return (text, false);
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let line_end = text[..end].rfind('\n').map_or(end, |at| at + 1);
    (&text[..line_end], true)
}

/// Diff output is shown to a model, not applied, so a stray invalid byte becomes U+FFFD.
fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_diff(name: &str, body_lines: usize) -> String {
        let mut text =
            format!("diff --git a/{name} b/{name}\n--- a/{name}\n+++ b/{name}\n@@ -1 +1 @@\n");
        for line in 0..body_lines {
            text.push_str(&format!("+line {line} of {name}\n"));
        }
        text
    }

    #[test]
    fn a_small_patch_is_kept_whole() {
        let patch = format!("{}{}", file_diff("a.txt", 3), file_diff("b.txt", 3));
        let (kept, truncated) = cap_patch(&patch);
        assert_eq!(kept, patch);
        assert!(!truncated);
    }

    #[test]
    fn no_patch_is_nothing_and_not_truncated() {
        assert_eq!(cap_patch(""), (String::new(), false));
    }

    #[test]
    fn one_big_file_is_cut_at_a_line_and_does_not_starve_the_next() {
        let big = file_diff("lock.json", 5_000);
        let small = file_diff("small.txt", 2);
        let (kept, truncated) = cap_patch(&format!("{big}{small}"));
        assert!(truncated);
        assert!(kept.len() <= MESSAGE_PATCH_LIMIT);
        assert!(kept.contains("bytes of this file's diff omitted"));
        assert!(kept.contains("diff --git a/small.txt b/small.txt"));
        let big_part = &kept[..kept.find("diff --git a/small.txt").expect("second file")];
        assert!(big_part.len() <= MESSAGE_FILE_PATCH_LIMIT + MARKER_ROOM);
        assert!(!big_part.contains("line 4999"));
    }

    #[test]
    fn many_files_stop_at_the_total_limit_and_name_how_many_were_left_out() {
        let patch: String = (0..60)
            .map(|n| file_diff(&format!("file{n}.txt"), 400))
            .collect();
        let (kept, truncated) = cap_patch(&patch);
        assert!(truncated);
        assert!(kept.len() <= MESSAGE_PATCH_LIMIT, "{} bytes", kept.len());
        assert!(kept.contains("more files omitted"));
        assert!(kept.starts_with("diff --git a/file0.txt"));
    }

    #[test]
    fn cutting_respects_character_boundaries() {
        let text = format!("{}\n{}", "é".repeat(10), "ü".repeat(10));
        let (kept, cut) = cut_at_line(&text, 25);
        assert!(cut);
        assert_eq!(kept, format!("{}\n", "é".repeat(10)));
        let long_line = "é".repeat(50);
        let (single_line, _) = cut_at_line(&long_line, 15);
        assert_eq!(single_line.len(), 14);
    }

    #[test]
    fn files_are_split_at_their_header_lines_only() {
        let patch = format!(
            "{}+ diff --git inside a line\n{}",
            file_diff("a.txt", 1),
            file_diff("b.txt", 1)
        );
        let files = split_files(&patch);
        assert_eq!(files.len(), 2);
        assert!(files[0].contains("+ diff --git inside a line"));
    }
}
