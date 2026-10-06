use crate::graph::paths;

type HasFile<'a> = &'a dyn Fn(&str) -> bool;

/// A sourced path is relative to the working directory at run time, which is
/// usually the script's directory or the repository root; both are tried.
pub(super) fn resolve(from: &str, path: &str, has_file: HasFile<'_>) -> Option<String> {
    if paths::is_absolute(path) || path.starts_with('~') || path.contains(['*', '?', '$']) {
        return None;
    }
    [paths::parent(from), ""]
        .into_iter()
        .filter_map(|dir| paths::join(dir, path))
        .find(|candidate| has_file(candidate))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn run(files: &[&str], from: &str, path: &str) -> Option<String> {
        let set: HashSet<String> = files.iter().map(ToString::to_string).collect();
        resolve(from, path, &|candidate| set.contains(candidate))
    }

    #[test]
    fn tries_the_script_directory_then_the_root() {
        let files = ["scripts/lib.sh", "common.sh"];
        assert_eq!(
            run(&files, "scripts/run.sh", "./lib.sh").as_deref(),
            Some("scripts/lib.sh")
        );
        assert_eq!(
            run(&files, "scripts/run.sh", "common.sh").as_deref(),
            Some("common.sh")
        );
    }

    #[test]
    fn paths_that_are_not_plain_relative_literals_are_skipped() {
        let files = ["lib.sh"];
        for path in ["/etc/profile", "~/.bashrc", "lib*.sh", "$DIR/lib.sh"] {
            assert_eq!(run(&files, "run.sh", path), None, "{path}");
        }
    }

    #[test]
    fn missing_files_do_not_resolve() {
        assert_eq!(run(&["a.sh"], "run.sh", "missing.sh"), None);
    }
}
