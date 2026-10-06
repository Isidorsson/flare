pub fn normalize_separators(path: &str) -> String {
    let unified = path.replace('\\', "/");
    if let Some(rest) = unified.strip_prefix("//?/UNC/") {
        return format!("//{rest}");
    }
    unified
        .strip_prefix("//?/")
        .map_or(unified.clone(), str::to_string)
}

pub fn is_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with('/')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
}

pub fn clean(path: &str) -> Option<String> {
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            other => segments.push(other),
        }
    }
    Some(segments.join("/"))
}

pub fn join(dir: &str, relative: &str) -> Option<String> {
    if dir.is_empty() {
        clean(relative)
    } else {
        clean(&format!("{dir}/{relative}"))
    }
}

pub fn child(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

pub fn parent(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

pub fn file_name(path: &str) -> &str {
    path.rsplit_once('/').map_or(path, |(_, name)| name)
}

pub fn extension(path: &str) -> Option<&str> {
    let name = file_name(path);
    name.rsplit_once('.')
        .filter(|(stem, _)| !stem.is_empty())
        .map(|(_, ext)| ext)
}

pub fn ancestor_dirs(dir: &str) -> Vec<&str> {
    let mut dirs = Vec::new();
    let mut current = dir;
    loop {
        dirs.push(current);
        if current.is_empty() {
            return dirs;
        }
        current = parent(current);
    }
}

fn strip_prefix_for_platform<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    let head = path.get(..prefix.len())?;
    let matches = if cfg!(windows) {
        head.eq_ignore_ascii_case(prefix)
    } else {
        head == prefix
    };
    matches.then(|| &path[prefix.len()..])
}

pub fn strip_root(root: &str, path: &str) -> Option<String> {
    let path = normalize_separators(path);
    if !is_absolute(&path) {
        return clean(&path);
    }
    let root = root.trim_end_matches('/');
    let remainder = strip_prefix_for_platform(&path, root)?;
    if !remainder.is_empty() && !remainder.starts_with('/') {
        return None;
    }
    clean(remainder)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_windows_and_verbatim_prefixes() {
        assert_eq!(normalize_separators(r"C:\Users\me\app"), "C:/Users/me/app");
        assert_eq!(normalize_separators(r"\\?\C:\Users\me"), "C:/Users/me");
        assert_eq!(
            normalize_separators(r"\\?\UNC\server\share\x"),
            "//server/share/x"
        );
    }

    #[test]
    fn detects_absolute_paths() {
        assert!(is_absolute("C:/a"));
        assert!(is_absolute("/home/a"));
        assert!(!is_absolute("src/a.ts"));
        assert!(!is_absolute("a"));
    }

    #[test]
    fn cleans_dot_segments_and_rejects_escapes() {
        assert_eq!(clean("a/./b/../c").as_deref(), Some("a/c"));
        assert_eq!(clean("./a//b/").as_deref(), Some("a/b"));
        assert_eq!(clean("../a"), None);
        assert_eq!(clean("a/../.."), None);
        assert_eq!(clean("").as_deref(), Some(""));
    }

    #[test]
    fn joins_relative_to_a_directory() {
        assert_eq!(join("src/app", "../lib/x").as_deref(), Some("src/lib/x"));
        assert_eq!(join("", "./x").as_deref(), Some("x"));
        assert_eq!(join("src", "../../x"), None);
    }

    #[test]
    fn splits_paths() {
        assert_eq!(parent("a/b/c.ts"), "a/b");
        assert_eq!(parent("c.ts"), "");
        assert_eq!(file_name("a/b/c.ts"), "c.ts");
        assert_eq!(extension("a/b/c.test.ts"), Some("ts"));
        assert_eq!(extension("a/.gitignore"), None);
        assert_eq!(extension("a/Makefile"), None);
        assert_eq!(child("", "x"), "x");
        assert_eq!(child("a", "x"), "a/x");
    }

    #[test]
    fn lists_ancestor_directories_innermost_first() {
        assert_eq!(ancestor_dirs("a/b"), vec!["a/b", "a", ""]);
        assert_eq!(ancestor_dirs(""), vec![""]);
    }

    #[test]
    fn strips_the_workspace_root_from_absolute_paths() {
        assert_eq!(
            strip_root("C:/app", r"C:\app\src\a.ts").as_deref(),
            Some("src/a.ts")
        );
        assert_eq!(
            strip_root("C:/app/", "C:/app/src/a.ts").as_deref(),
            Some("src/a.ts")
        );
        assert_eq!(strip_root("C:/app", "C:/app").as_deref(), Some(""));
        assert_eq!(strip_root("C:/app", "C:/application/a.ts"), None);
        assert_eq!(strip_root("C:/app", "D:/other/a.ts"), None);
    }

    #[test]
    fn passes_relative_paths_through_cleaned() {
        assert_eq!(
            strip_root("C:/app", r".\src\a.ts").as_deref(),
            Some("src/a.ts")
        );
        assert_eq!(strip_root("C:/app", "../x"), None);
    }

    #[cfg(windows)]
    #[test]
    fn matches_the_root_case_insensitively_on_windows() {
        assert_eq!(
            strip_root("C:/App", "c:/app/src/a.ts").as_deref(),
            Some("src/a.ts")
        );
    }
}
