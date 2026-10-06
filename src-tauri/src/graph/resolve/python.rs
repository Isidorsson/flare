use crate::graph::paths;

const SOURCE_LAYOUT_DIR: &str = "src";
const PACKAGE_INIT: &str = "__init__.py";

pub(super) fn resolve(
    from: &str,
    level: usize,
    module: &[String],
    names: &[String],
    has_file: &dyn Fn(&str) -> bool,
) -> Vec<String> {
    if level > 0 {
        return relative_base(from, level)
            .map(|base| targets_under(&base, module, names, has_file))
            .unwrap_or_default();
    }
    if module.is_empty() {
        return Vec::new();
    }
    search_roots(from)
        .into_iter()
        .map(|root| targets_under(&root, module, names, has_file))
        .find(|targets| !targets.is_empty())
        .unwrap_or_default()
}

fn relative_base(from: &str, level: usize) -> Option<String> {
    let mut base = paths::parent(from);
    for _ in 1..level {
        if base.is_empty() {
            return None;
        }
        base = paths::parent(base);
    }
    Some(base.to_string())
}

fn search_roots(from: &str) -> Vec<String> {
    let mut roots = Vec::new();
    for dir in paths::ancestor_dirs(paths::parent(from)) {
        roots.push(dir.to_string());
        roots.push(paths::child(dir, SOURCE_LAYOUT_DIR));
    }
    roots
}

fn targets_under(
    base: &str,
    module: &[String],
    names: &[String],
    has_file: &dyn Fn(&str) -> bool,
) -> Vec<String> {
    let module_dir = module
        .iter()
        .fold(base.to_string(), |dir, segment| paths::child(&dir, segment));
    let own = if module.is_empty() {
        let init = paths::child(&module_dir, PACKAGE_INIT);
        has_file(&init).then_some(init)
    } else {
        module_file(&module_dir, has_file)
    };
    let mut targets: Vec<String> = own.into_iter().collect();
    targets.extend(
        names
            .iter()
            .filter_map(|name| module_file(&paths::child(&module_dir, name), has_file)),
    );
    targets
}

fn module_file(module_path: &str, has_file: &dyn Fn(&str) -> bool) -> Option<String> {
    let file = format!("{module_path}.py");
    let package = paths::child(module_path, PACKAGE_INIT);
    [file, package]
        .into_iter()
        .find(|candidate| has_file(candidate))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn run(
        files: &[&str],
        from: &str,
        level: usize,
        module: &[&str],
        names: &[&str],
    ) -> Vec<String> {
        let set: HashSet<String> = files.iter().map(ToString::to_string).collect();
        let owned = |items: &[&str]| items.iter().map(ToString::to_string).collect::<Vec<_>>();
        resolve(from, level, &owned(module), &owned(names), &|path| {
            set.contains(path)
        })
    }

    #[test]
    fn resolves_absolute_modules_to_files_and_packages() {
        let files = ["app/models.py", "app/db/__init__.py", "app/db/session.py"];
        assert_eq!(
            run(&files, "main.py", 0, &["app", "models"], &[]),
            ["app/models.py"]
        );
        assert_eq!(
            run(&files, "main.py", 0, &["app", "db"], &[]),
            ["app/db/__init__.py"]
        );
        assert_eq!(
            run(&files, "main.py", 0, &["app", "db", "session"], &[]),
            ["app/db/session.py"]
        );
    }

    #[test]
    fn from_imports_also_link_imported_submodules() {
        let files = [
            "app/db/__init__.py",
            "app/db/session.py",
            "app/db/models.py",
        ];
        let targets = run(
            &files,
            "main.py",
            0,
            &["app", "db"],
            &["session", "models", "Thing"],
        );
        assert_eq!(
            targets,
            [
                "app/db/__init__.py",
                "app/db/session.py",
                "app/db/models.py"
            ]
        );
    }

    #[test]
    fn namespace_packages_without_init_still_resolve_submodules() {
        let files = ["ns/inner.py"];
        assert_eq!(
            run(&files, "main.py", 0, &["ns"], &["inner"]),
            ["ns/inner.py"]
        );
    }

    #[test]
    fn resolves_relative_imports_by_level() {
        let files = [
            "pkg/__init__.py",
            "pkg/sibling.py",
            "pkg/sub/__init__.py",
            "pkg/sub/mod.py",
            "pkg/sub/deep/leaf.py",
        ];
        assert_eq!(
            run(&files, "pkg/sub/mod.py", 1, &[], &[]),
            ["pkg/sub/__init__.py"]
        );
        assert_eq!(
            run(&files, "pkg/sub/mod.py", 1, &["deep", "leaf"], &[]),
            ["pkg/sub/deep/leaf.py"]
        );
        assert_eq!(
            run(&files, "pkg/sub/mod.py", 2, &["sibling"], &[]),
            ["pkg/sibling.py"]
        );
        assert_eq!(
            run(&files, "pkg/sub/mod.py", 2, &[], &["sibling"]),
            ["pkg/__init__.py", "pkg/sibling.py"]
        );
        assert!(run(&files, "pkg/sub/mod.py", 4, &["x"], &[]).is_empty());
    }

    #[test]
    fn searches_ancestor_and_src_layout_roots() {
        let files = [
            "backend/app/core.py",
            "backend/app/api/routes.py",
            "lib/src/pkg/util.py",
        ];
        assert_eq!(
            run(
                &files,
                "backend/app/api/routes.py",
                0,
                &["app", "core"],
                &[]
            ),
            ["backend/app/core.py"]
        );
        assert_eq!(
            run(&files, "lib/tests/test_util.py", 0, &["pkg", "util"], &[]),
            ["lib/src/pkg/util.py"]
        );
    }

    #[test]
    fn prefers_the_innermost_root_and_ignores_unknown_modules() {
        let files = ["util.py", "pkg/util.py"];
        assert_eq!(
            run(&files, "pkg/main.py", 0, &["util"], &[]),
            ["pkg/util.py"]
        );
        assert!(run(&files, "pkg/main.py", 0, &["os"], &[]).is_empty());
        assert!(run(&files, "pkg/main.py", 0, &[], &[]).is_empty());
    }
}
