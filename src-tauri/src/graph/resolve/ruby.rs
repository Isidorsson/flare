use crate::graph::paths;

type HasFile<'a> = &'a dyn Fn(&str) -> bool;

const SOURCE_EXTENSION: &str = ".rb";
const LOAD_PATH_DIR: &str = "lib";

/// `require_relative` and `./`-style requires are relative to the file. Other
/// requires are looked up under `lib/` at every enclosing level, the directory
/// a gem layout (or `$LOAD_PATH.unshift`) puts on the load path.
pub(super) fn resolve(
    from: &str,
    path: &str,
    relative: bool,
    has_file: HasFile<'_>,
) -> Option<String> {
    let file = with_extension(path);
    if relative || file.starts_with("./") || file.starts_with("../") {
        let candidate = paths::join(paths::parent(from), &file)?;
        return has_file(&candidate).then_some(candidate);
    }
    paths::ancestor_dirs(paths::parent(from))
        .into_iter()
        .filter_map(|dir| paths::join(&paths::child(dir, LOAD_PATH_DIR), &file))
        .find(|candidate| has_file(candidate))
}

fn with_extension(path: &str) -> String {
    if path.ends_with(SOURCE_EXTENSION) {
        path.to_string()
    } else {
        format!("{path}{SOURCE_EXTENSION}")
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn run(files: &[&str], from: &str, path: &str, relative: bool) -> Option<String> {
        let set: HashSet<String> = files.iter().map(ToString::to_string).collect();
        resolve(from, path, relative, &|candidate| set.contains(candidate))
    }

    #[test]
    fn require_relative_resolves_beside_the_file_with_or_without_extension() {
        let files = ["lib/a/b.rb", "lib/a/c.rb"];
        assert_eq!(
            run(&files, "lib/a/x.rb", "b", true).as_deref(),
            Some("lib/a/b.rb")
        );
        assert_eq!(
            run(&files, "lib/a/x.rb", "./c.rb", true).as_deref(),
            Some("lib/a/c.rb")
        );
        assert_eq!(
            run(&files, "lib/a/deep/x.rb", "../b", true).as_deref(),
            Some("lib/a/b.rb")
        );
    }

    #[test]
    fn plain_require_searches_lib_at_every_enclosing_level() {
        let files = ["lib/mygem/core.rb", "gems/inner/lib/inner/util.rb"];
        assert_eq!(
            run(&files, "spec/core_spec.rb", "mygem/core", false).as_deref(),
            Some("lib/mygem/core.rb")
        );
        assert_eq!(
            run(&files, "gems/inner/spec/u_spec.rb", "inner/util", false).as_deref(),
            Some("gems/inner/lib/inner/util.rb")
        );
    }

    #[test]
    fn external_gems_and_missing_files_do_not_resolve() {
        let files = ["lib/mygem.rb"];
        assert_eq!(run(&files, "app.rb", "json", false), None);
        assert_eq!(run(&files, "app.rb", "missing", true), None);
        assert_eq!(run(&files, "app.rb", "../outside", true), None);
    }
}
