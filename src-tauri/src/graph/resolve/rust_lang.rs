use crate::graph::extract::RawImport;
use crate::graph::paths;

const LIB_FILE: &str = "lib.rs";
const MAIN_FILE: &str = "main.rs";
const BUILD_FILE: &str = "build.rs";
const MODULE_ENTRY_FILE: &str = "mod.rs";

type HasFile<'a> = &'a dyn Fn(&str) -> bool;

pub(super) fn resolve(from: &str, import: &RawImport, has_file: HasFile<'_>) -> Option<String> {
    match import {
        RawImport::RustMod { name, inline } => resolve_mod(from, name, inline, has_file),
        RawImport::RustUse { path, inline } => resolve_use(from, path, inline, has_file),
        _ => None,
    }
}

fn is_crate_root_file(name: &str) -> bool {
    matches!(name, LIB_FILE | MAIN_FILE | BUILD_FILE)
}

fn module_dir(file: &str) -> String {
    let dir = paths::parent(file);
    let name = paths::file_name(file);
    if is_crate_root_file(name) || name == MODULE_ENTRY_FILE {
        dir.to_string()
    } else {
        paths::child(dir, name.strip_suffix(".rs").unwrap_or(name))
    }
}

fn resolve_mod(from: &str, name: &str, inline: &[String], has_file: HasFile<'_>) -> Option<String> {
    let base = inline
        .iter()
        .fold(module_dir(from), |dir, segment| paths::child(&dir, segment));
    let sibling = paths::child(&base, &format!("{name}.rs"));
    let nested = paths::child(&paths::child(&base, name), MODULE_ENTRY_FILE);
    [sibling, nested]
        .into_iter()
        .find(|candidate| has_file(candidate))
}

fn crate_root_dir(from: &str, has_file: HasFile<'_>) -> Option<String> {
    paths::ancestor_dirs(paths::parent(from))
        .into_iter()
        .find(|dir| {
            has_file(&paths::child(dir, LIB_FILE)) || has_file(&paths::child(dir, MAIN_FILE))
        })
        .map(str::to_string)
}

fn current_module(from: &str, root_dir: &str) -> Option<Vec<String>> {
    let relative = if root_dir.is_empty() {
        from
    } else {
        from.strip_prefix(root_dir)?.strip_prefix('/')?
    };
    let mut segments: Vec<String> = relative.split('/').map(str::to_string).collect();
    let file = segments.pop()?;
    let stem = file.strip_suffix(".rs")?;
    let is_root_entry = segments.is_empty() && is_crate_root_file(&file);
    if stem != "mod" && !is_root_entry {
        segments.push(stem.to_string());
    }
    Some(segments)
}

fn module_file(root_dir: &str, segments: &[String], has_file: HasFile<'_>) -> Option<String> {
    if segments.is_empty() {
        return [LIB_FILE, MAIN_FILE]
            .into_iter()
            .map(|name| paths::child(root_dir, name))
            .find(|candidate| has_file(candidate));
    }
    let base = segments.iter().fold(root_dir.to_string(), |dir, segment| {
        paths::child(&dir, segment)
    });
    let file = format!("{base}.rs");
    let nested = paths::child(&base, MODULE_ENTRY_FILE);
    [file, nested]
        .into_iter()
        .find(|candidate| has_file(candidate))
}

struct UseScope<'a> {
    bases: Vec<Vec<String>>,
    rest: &'a [String],
    anchored: bool,
}

fn use_scope<'a>(
    path: &'a [String],
    inline: &[String],
    current: Vec<String>,
) -> Option<UseScope<'a>> {
    match path.first()?.as_str() {
        "crate" => Some(UseScope {
            bases: vec![Vec::new()],
            rest: &path[1..],
            anchored: true,
        }),
        "self" if inline.is_empty() => Some(UseScope {
            bases: vec![current],
            rest: &path[1..],
            anchored: true,
        }),
        "self" => None,
        "super" => {
            let ups = path
                .iter()
                .take_while(|segment| segment.as_str() == "super")
                .count();
            let levels = ups.checked_sub(inline.len()).filter(|levels| *levels > 0)?;
            let keep = current.len().checked_sub(levels)?;
            Some(UseScope {
                bases: vec![current[..keep].to_vec()],
                rest: &path[ups..],
                anchored: true,
            })
        }
        _ => {
            let mut bases = Vec::new();
            if inline.is_empty() {
                bases.push(current);
            }
            bases.push(Vec::new());
            Some(UseScope {
                bases,
                rest: path,
                anchored: false,
            })
        }
    }
}

fn resolve_use(
    from: &str,
    path: &[String],
    inline: &[String],
    has_file: HasFile<'_>,
) -> Option<String> {
    let root_dir = crate_root_dir(from, has_file)?;
    let current = current_module(from, &root_dir)?;
    let scope = use_scope(path, inline, current)?;
    scope.bases.iter().find_map(|base| {
        (0..=scope.rest.len()).rev().find_map(|take| {
            if take == 0 && !scope.anchored {
                return None;
            }
            let mut segments = base.clone();
            segments.extend_from_slice(&scope.rest[..take]);
            module_file(&root_dir, &segments, has_file)
        })
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    const TREE: [&str; 9] = [
        "src/lib.rs",
        "src/graph/mod.rs",
        "src/graph/model.rs",
        "src/graph/index.rs",
        "src/graph/index/child.rs",
        "src/util.rs",
        "src/util/inner.rs",
        "src/main.rs",
        "other/src/lib.rs",
    ];

    fn module(name: &str, inline: &[&str]) -> RawImport {
        RawImport::RustMod {
            name: name.to_string(),
            inline: inline.iter().map(ToString::to_string).collect(),
        }
    }

    fn using(path: &str, inline: &[&str]) -> RawImport {
        RawImport::RustUse {
            path: path.split("::").map(str::to_string).collect(),
            inline: inline.iter().map(ToString::to_string).collect(),
        }
    }

    fn run(from: &str, import: &RawImport) -> Option<String> {
        let set: HashSet<&str> = TREE.iter().copied().collect();
        resolve(from, import, &|path| set.contains(path))
    }

    #[test]
    fn mod_declarations_resolve_in_the_modules_directory() {
        assert_eq!(
            run("src/lib.rs", &module("graph", &[])).as_deref(),
            Some("src/graph/mod.rs")
        );
        assert_eq!(
            run("src/lib.rs", &module("util", &[])).as_deref(),
            Some("src/util.rs")
        );
        assert_eq!(
            run("src/graph/mod.rs", &module("model", &[])).as_deref(),
            Some("src/graph/model.rs")
        );
        assert_eq!(
            run("src/util.rs", &module("inner", &[])).as_deref(),
            Some("src/util/inner.rs")
        );
        assert_eq!(
            run("src/graph/index.rs", &module("child", &[])).as_deref(),
            Some("src/graph/index/child.rs")
        );
    }

    #[test]
    fn unknown_or_misplaced_mod_declarations_do_not_resolve() {
        assert_eq!(run("src/lib.rs", &module("missing", &[])), None);
        assert_eq!(run("src/util.rs", &module("model", &[])), None);
    }

    #[test]
    fn inline_modules_shift_the_directory_of_nested_declarations() {
        assert_eq!(run("src/util.rs", &module("inner", &["wrapper"])), None);
        let set: HashSet<&str> = ["src/lib.rs", "src/util/wrapper/inner.rs", "src/util.rs"]
            .into_iter()
            .collect();
        let found = resolve("src/util.rs", &module("inner", &["wrapper"]), &|path| {
            set.contains(path)
        });
        assert_eq!(found.as_deref(), Some("src/util/wrapper/inner.rs"));
    }

    #[test]
    fn crate_paths_resolve_to_the_longest_module_prefix() {
        assert_eq!(
            run("src/util.rs", &using("crate::graph::model::Thing", &[])).as_deref(),
            Some("src/graph/model.rs")
        );
        assert_eq!(
            run("src/util.rs", &using("crate::graph::Thing", &[])).as_deref(),
            Some("src/graph/mod.rs")
        );
        assert_eq!(
            run("src/graph/model.rs", &using("crate::Thing", &[])).as_deref(),
            Some("src/lib.rs")
        );
        assert_eq!(
            run("src/util.rs", &using("crate::util::inner::f", &[])).as_deref(),
            Some("src/util/inner.rs")
        );
    }

    #[test]
    fn self_and_super_are_relative_to_the_current_module() {
        assert_eq!(
            run("src/graph/index.rs", &using("super::model::Thing", &[])).as_deref(),
            Some("src/graph/model.rs")
        );
        assert_eq!(
            run("src/graph/index.rs", &using("super::*", &[])).as_deref(),
            Some("src/graph/mod.rs")
        );
        assert_eq!(
            run("src/graph/index.rs", &using("self::child::f", &[])).as_deref(),
            Some("src/graph/index/child.rs")
        );
        assert_eq!(
            run("src/graph/mod.rs", &using("self::model::Thing", &[])).as_deref(),
            Some("src/graph/model.rs")
        );
        assert_eq!(
            run(
                "src/graph/index/child.rs",
                &using("super::super::model::T", &[])
            )
            .as_deref(),
            Some("src/graph/model.rs")
        );
        assert_eq!(
            run(
                "src/graph/index/child.rs",
                &using("super::super::super::util::f", &[])
            )
            .as_deref(),
            Some("src/util.rs")
        );
        assert_eq!(
            run("src/graph/index.rs", &using("super::super::Thing", &[])).as_deref(),
            Some("src/lib.rs")
        );
    }

    #[test]
    fn inline_test_modules_do_not_link_to_the_enclosing_files_parent() {
        assert_eq!(
            run("src/graph/index.rs", &using("super::Thing", &["tests"])),
            None
        );
        assert_eq!(
            run(
                "src/graph/index.rs",
                &using("super::super::model::T", &["tests"])
            )
            .as_deref(),
            Some("src/graph/model.rs")
        );
        assert_eq!(
            run("src/graph/index.rs", &using("self::helper", &["tests"])),
            None
        );
    }

    #[test]
    fn bare_paths_try_the_current_module_then_the_crate_root() {
        assert_eq!(
            run("src/graph/mod.rs", &using("model::Thing", &[])).as_deref(),
            Some("src/graph/model.rs")
        );
        assert_eq!(
            run("src/util.rs", &using("graph::model", &[])).as_deref(),
            Some("src/graph/model.rs")
        );
        assert_eq!(
            run("src/util.rs", &using("std::collections::HashMap", &[])),
            None
        );
        assert_eq!(run("src/util.rs", &using("serde", &[])), None);
    }

    #[test]
    fn files_resolve_against_their_own_crate_root() {
        assert_eq!(
            run("other/src/lib.rs", &using("crate::missing", &[])).as_deref(),
            Some("other/src/lib.rs")
        );
        assert_eq!(run("stray/file.rs", &using("crate::graph", &[])), None);
    }
}
