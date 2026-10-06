use crate::graph::paths;

type HasFile<'a> = &'a dyn Fn(&str) -> bool;

const INCLUDE_DIRS: [&str; 3] = ["include", "src", ""];

/// A quoted include is looked up beside the including file first, as compilers
/// do, then in `include/`, `src/` and the directory itself at every enclosing
/// level, standing in for the `-I` flags a build system would pass.
pub(super) fn resolve(from: &str, include: &str, has_file: HasFile<'_>) -> Option<String> {
    let beside = paths::join(paths::parent(from), include);
    let guessed = paths::ancestor_dirs(paths::parent(from))
        .into_iter()
        .flat_map(|dir| {
            INCLUDE_DIRS
                .iter()
                .filter_map(move |sub| paths::join(&paths::child(dir, sub), include))
        });
    beside
        .into_iter()
        .chain(guessed)
        .find(|candidate| has_file(candidate))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn run(files: &[&str], from: &str, include: &str) -> Option<String> {
        let set: HashSet<String> = files.iter().map(ToString::to_string).collect();
        resolve(from, include, &|path| set.contains(path))
    }

    #[test]
    fn prefers_the_directory_of_the_including_file() {
        let files = ["src/a/x.h", "include/x.h"];
        assert_eq!(
            run(&files, "src/a/main.c", "x.h").as_deref(),
            Some("src/a/x.h")
        );
    }

    #[test]
    fn falls_back_to_include_src_and_root_directories() {
        let files = ["include/lib/api.h", "src/util/log.h", "root.h"];
        assert_eq!(
            run(&files, "src/app/main.c", "lib/api.h").as_deref(),
            Some("include/lib/api.h")
        );
        assert_eq!(
            run(&files, "src/app/main.c", "util/log.h").as_deref(),
            Some("src/util/log.h")
        );
        assert_eq!(
            run(&files, "src/app/main.c", "root.h").as_deref(),
            Some("root.h")
        );
    }

    #[test]
    fn nested_projects_use_their_own_include_directory() {
        let files = ["third/dep/include/dep/dep.h", "include/dep/dep.h"];
        assert_eq!(
            run(&files, "third/dep/src/dep.c", "dep/dep.h").as_deref(),
            Some("third/dep/include/dep/dep.h")
        );
    }

    #[test]
    fn parent_relative_includes_are_cleaned() {
        let files = ["inc/x.h"];
        assert_eq!(
            run(&files, "src/m.c", "../inc/x.h").as_deref(),
            Some("inc/x.h")
        );
    }

    #[test]
    fn unknown_headers_resolve_to_nothing() {
        assert_eq!(run(&["a.h"], "m.c", "missing.h"), None);
    }
}
