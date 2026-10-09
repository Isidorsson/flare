//! Paths arrive from the webview, so each one is checked before it reaches git or the disk: it
//! must be relative and stay inside the repository. Git then receives it after `--`, and the
//! runner turns pathspec magic off (`GIT_LITERAL_PATHSPECS`), so a name like `[id].tsx` or `*.rs`
//! means exactly that file.

use super::error::VcsError;

/// Windows refuses a command line over 32,767 characters; staying well under it leaves room for
/// the program, the flags and quoting.
const ARG_BYTE_BUDGET: usize = 24_000;

/// The path as given, once it is known to be a safe repository-relative path. A single trailing
/// slash is allowed because git reports nested repositories as `dir/`.
pub fn validate(path: &str) -> Result<&str, VcsError> {
    let invalid = |reason: &str| VcsError::InvalidRequest(format!("path {path:?} {reason}"));
    if path.is_empty() {
        return Err(invalid("is empty"));
    }
    if path.contains(['\0', '\n', '\r']) {
        return Err(invalid("contains a control character"));
    }
    if path.starts_with(['/', '\\']) || has_drive_prefix(path) {
        return Err(invalid(
            "is absolute: use a path relative to the repository",
        ));
    }
    let body = path.strip_suffix(['/', '\\']).unwrap_or(path);
    for part in body.split(['/', '\\']) {
        match part {
            "" => return Err(invalid("has an empty folder name")),
            "." | ".." => return Err(invalid("must stay inside the repository")),
            _ => {}
        }
    }
    Ok(path)
}

pub fn validate_all(paths: &[String]) -> Result<(), VcsError> {
    paths.iter().try_for_each(|path| validate(path).map(drop))
}

/// Splits a long path list into slices that each fit on one command line.
pub fn chunks(paths: &[String]) -> Vec<&[String]> {
    let mut chunks = Vec::new();
    let mut start = 0;
    let mut size = 0;
    for (index, path) in paths.iter().enumerate() {
        let cost = path.len() + 1;
        if index > start && size + cost > ARG_BYTE_BUDGET {
            chunks.push(&paths[start..index]);
            start = index;
            size = 0;
        }
        size += cost;
    }
    if start < paths.len() {
        chunks.push(&paths[start..]);
    }
    chunks
}

fn has_drive_prefix(path: &str) -> bool {
    let mut chars = path.chars();
    matches!((chars.next(), chars.next()), (Some(drive), Some(':')) if drive.is_ascii_alphabetic())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rejected(path: &str) -> String {
        validate(path).expect_err("rejected").to_string()
    }

    #[test]
    fn relative_paths_pass_unchanged() {
        for path in [
            "a.txt",
            "src/main.rs",
            "dir/",
            "[id].tsx",
            "with space/a b.txt",
            "..hidden/x",
            "a/b..c",
        ] {
            assert_eq!(validate(path).expect("valid"), path);
        }
    }

    #[test]
    fn parent_folders_are_rejected_in_any_position_and_separator() {
        for path in ["..", "../x", "a/../b", "a/..", "..\\x", "a\\..\\b"] {
            assert!(rejected(path).contains("inside the repository"), "{path}");
        }
    }

    #[test]
    fn absolute_paths_are_rejected() {
        for path in ["/etc/passwd", "\\\\server\\share", "C:\\x", "c:/x", "\\x"] {
            assert!(rejected(path).contains("absolute"), "{path}");
        }
    }

    #[test]
    fn empty_names_dots_and_control_characters_are_rejected() {
        assert!(rejected("").contains("empty"));
        assert!(rejected("a//b").contains("empty folder name"));
        assert!(rejected("./a").contains("inside the repository"));
        assert!(rejected("a\0b").contains("control character"));
        assert!(rejected("a\nb").contains("control character"));
    }

    #[test]
    fn one_bad_path_rejects_the_whole_list() {
        let paths = vec!["ok.txt".to_owned(), "../bad".to_owned()];
        assert!(validate_all(&paths).is_err());
        assert!(validate_all(&[]).is_ok());
    }

    #[test]
    fn short_lists_stay_in_one_chunk_and_empty_lists_in_none() {
        let paths: Vec<String> = (0..10).map(|n| format!("f{n}.txt")).collect();
        assert_eq!(chunks(&paths).len(), 1);
        assert!(chunks(&[]).is_empty());
    }

    #[test]
    fn long_lists_are_split_without_losing_or_reordering_paths() {
        let paths: Vec<String> = (0..2_000).map(|n| format!("{n:0>40}.txt")).collect();
        let split = chunks(&paths);
        assert!(split.len() > 1);
        for chunk in &split {
            let size: usize = chunk.iter().map(|path| path.len() + 1).sum();
            assert!(size <= ARG_BYTE_BUDGET);
        }
        let rejoined: Vec<&String> = split.iter().flat_map(|chunk| chunk.iter()).collect();
        assert_eq!(rejoined, paths.iter().collect::<Vec<_>>());
    }

    #[test]
    fn a_single_oversized_path_still_gets_its_own_chunk() {
        let paths = vec!["x".repeat(ARG_BYTE_BUDGET + 10), "y".to_owned()];
        let split = chunks(&paths);
        assert_eq!(split.len(), 2);
        assert_eq!(split[0].len(), 1);
    }
}
