use crate::graph::paths;

type HasFile<'a> = &'a dyn Fn(&str) -> bool;

const SOURCE_EXTENSION: &str = ".zig";

/// Zig named modules (`std`, `builtin`, build.zig modules) have no `.zig` suffix;
/// only file paths are resolved, relative to the importing file.
pub(super) fn resolve(from: &str, path: &str, has_file: HasFile<'_>) -> Option<String> {
    if !path.ends_with(SOURCE_EXTENSION) {
        return None;
    }
    let candidate = paths::join(paths::parent(from), path)?;
    has_file(&candidate).then_some(candidate)
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
    fn imports_resolve_relative_to_the_file() {
        let files = ["src/a.zig", "src/sub/b.zig", "top.zig"];
        assert_eq!(
            run(&files, "src/main.zig", "a.zig").as_deref(),
            Some("src/a.zig")
        );
        assert_eq!(
            run(&files, "src/main.zig", "sub/b.zig").as_deref(),
            Some("src/sub/b.zig")
        );
        assert_eq!(
            run(&files, "src/main.zig", "../top.zig").as_deref(),
            Some("top.zig")
        );
    }

    #[test]
    fn named_modules_and_missing_files_do_not_resolve() {
        let files = ["src/a.zig"];
        assert_eq!(run(&files, "src/main.zig", "std"), None);
        assert_eq!(run(&files, "src/main.zig", "nope.zig"), None);
    }
}
