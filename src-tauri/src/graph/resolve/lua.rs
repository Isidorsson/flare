use crate::graph::extract::{RawImport, ScriptStep};
use crate::graph::lang::SourceKind;
use crate::graph::paths;

type HasFile<'a> = &'a dyn Fn(&str) -> bool;

const LUA_EXTENSIONS: [&str; 1] = ["lua"];
const LUAU_EXTENSIONS: [&str; 2] = ["luau", "lua"];
const INSTANCE_SUFFIXES: [&str; 3] = ["", ".server", ".client"];
const INIT_STEM: &str = "init";
const SEARCH_SUBDIRS: [&str; 3] = ["", "src", "lua"];

pub(super) fn resolve(
    from: &str,
    kind: SourceKind,
    import: &RawImport,
    has_file: HasFile<'_>,
) -> Vec<String> {
    let found = match import {
        RawImport::LuaModule { name } => resolve_module(from, kind, name, has_file),
        RawImport::RobloxPath { steps } => resolve_instance_path(from, steps, has_file),
        _ => None,
    };
    found.into_iter().collect()
}

fn extensions(kind: SourceKind) -> &'static [&'static str] {
    if kind == SourceKind::Luau {
        &LUAU_EXTENSIONS
    } else {
        &LUA_EXTENSIONS
    }
}

/// Mirrors the default `package.path` (`?.lua;?/init.lua`) from every enclosing
/// directory and its `src`/`lua` subdirectories, innermost first. Luau string
/// requires starting with `./` or `../` are relative to the requiring file.
fn resolve_module(
    from: &str,
    kind: SourceKind,
    name: &str,
    has_file: HasFile<'_>,
) -> Option<String> {
    let extensions = extensions(kind);
    if name.starts_with("./") || name.starts_with("../") {
        let base = paths::join(paths::parent(from), name)?;
        return probe_module(&base, extensions, has_file);
    }
    let relative = name.replace('.', "/");
    paths::ancestor_dirs(paths::parent(from))
        .into_iter()
        .flat_map(|dir| {
            SEARCH_SUBDIRS.iter().map(move |sub| {
                if sub.is_empty() {
                    dir.to_string()
                } else {
                    paths::child(dir, sub)
                }
            })
        })
        .filter_map(|root| paths::join(&root, &relative))
        .find_map(|base| probe_module(&base, extensions, has_file))
}

fn probe_module(base: &str, extensions: &[&str], has_file: HasFile<'_>) -> Option<String> {
    let files = extensions.iter().map(|ext| format!("{base}.{ext}"));
    let inits = extensions
        .iter()
        .map(|ext| paths::child(base, &format!("{INIT_STEM}.{ext}")));
    files.chain(inits).find(|candidate| has_file(candidate))
}

/// Where a Roblox instance sits in a Rojo-style file tree: a script file, or a
/// directory standing for a folder or for an `init` script.
enum Position {
    File(String),
    Dir(String),
}

impl Position {
    fn of_script(path: &str) -> Self {
        if paths::file_name(path).starts_with("init.") {
            Self::Dir(paths::parent(path).to_string())
        } else {
            Self::File(path.to_string())
        }
    }

    fn step(&self, step: &ScriptStep) -> Option<Self> {
        match (self, step) {
            (Self::File(path), ScriptStep::Parent) => {
                Some(Self::Dir(paths::parent(path).to_string()))
            }
            (Self::Dir(dir), ScriptStep::Parent) if !dir.is_empty() => {
                Some(Self::Dir(paths::parent(dir).to_string()))
            }
            (Self::Dir(dir), ScriptStep::Child(name)) => Some(Self::Dir(paths::child(dir, name))),
            _ => None,
        }
    }

    fn module_file(&self, has_file: HasFile<'_>) -> Option<String> {
        let Self::Dir(dir) = self else { return None };
        let as_file = (!dir.is_empty()).then(|| dir.clone());
        let as_init = paths::child(dir, INIT_STEM);
        as_file
            .into_iter()
            .chain([as_init])
            .flat_map(|stem| instance_files(&stem))
            .find(|candidate| has_file(candidate))
    }
}

fn instance_files(stem: &str) -> Vec<String> {
    INSTANCE_SUFFIXES
        .iter()
        .flat_map(|suffix| {
            LUAU_EXTENSIONS
                .iter()
                .map(move |ext| format!("{stem}{suffix}.{ext}"))
        })
        .collect()
}

fn resolve_instance_path(
    from: &str,
    steps: &[ScriptStep],
    has_file: HasFile<'_>,
) -> Option<String> {
    let mut position = Position::of_script(from);
    for step in steps {
        position = position.step(step)?;
    }
    position.module_file(has_file)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn run(files: &[&str], from: &str, kind: SourceKind, import: &RawImport) -> Vec<String> {
        let set: HashSet<String> = files.iter().map(ToString::to_string).collect();
        resolve(from, kind, import, &|path| set.contains(path))
    }

    fn module(name: &str) -> RawImport {
        RawImport::LuaModule { name: name.into() }
    }

    fn instance(path: &[&str]) -> RawImport {
        RawImport::RobloxPath {
            steps: path
                .iter()
                .map(|part| match *part {
                    "^" => ScriptStep::Parent,
                    name => ScriptStep::Child(name.to_string()),
                })
                .collect(),
        }
    }

    #[test]
    fn dotted_names_resolve_to_files_and_init_files() {
        let files = ["util/str.lua", "pkg/init.lua"];
        assert_eq!(
            run(&files, "main.lua", SourceKind::Lua, &module("util.str")),
            ["util/str.lua"]
        );
        assert_eq!(
            run(&files, "main.lua", SourceKind::Lua, &module("pkg")),
            ["pkg/init.lua"]
        );
    }

    #[test]
    fn searches_ancestor_directories_with_src_and_lua_roots() {
        let files = [
            "plugin/lua/mod/util.lua",
            "lib/src/core.lua",
            "near/helper.lua",
        ];
        assert_eq!(
            run(
                &files,
                "plugin/lua/mod/main.lua",
                SourceKind::Lua,
                &module("mod.util")
            ),
            ["plugin/lua/mod/util.lua"]
        );
        assert_eq!(
            run(&files, "lib/test/t.lua", SourceKind::Lua, &module("core")),
            ["lib/src/core.lua"]
        );
        assert_eq!(
            run(&files, "near/main.lua", SourceKind::Lua, &module("helper")),
            ["near/helper.lua"]
        );
    }

    #[test]
    fn the_file_directory_wins_over_the_workspace_root() {
        let files = ["x.lua", "sub/x.lua"];
        assert_eq!(
            run(&files, "sub/main.lua", SourceKind::Lua, &module("x")),
            ["sub/x.lua"]
        );
    }

    #[test]
    fn luau_prefers_its_own_extension_and_lua_does_not_see_luau() {
        let files = ["m.luau", "m.lua"];
        assert_eq!(
            run(&files, "a.luau", SourceKind::Luau, &module("m")),
            ["m.luau"]
        );
        assert_eq!(
            run(&["m.luau"], "a.lua", SourceKind::Lua, &module("m")),
            Vec::<String>::new()
        );
    }

    #[test]
    fn luau_relative_string_requires_resolve_against_the_file() {
        let files = ["a/b.luau", "a/c/init.luau", "up.luau"];
        assert_eq!(
            run(&files, "a/x.luau", SourceKind::Luau, &module("./b")),
            ["a/b.luau"]
        );
        assert_eq!(
            run(&files, "a/x.luau", SourceKind::Luau, &module("./c")),
            ["a/c/init.luau"]
        );
        assert_eq!(
            run(&files, "a/x.luau", SourceKind::Luau, &module("../up")),
            ["up.luau"]
        );
        assert!(run(&files, "x.luau", SourceKind::Luau, &module("../up")).is_empty());
    }

    #[test]
    fn unknown_modules_resolve_to_nothing() {
        assert!(run(
            &["a.lua"],
            "main.lua",
            SourceKind::Lua,
            &module("socket.http")
        )
        .is_empty());
    }

    #[test]
    fn roblox_sibling_and_cousin_paths_follow_the_instance_tree() {
        let files = [
            "src/a/Main.luau",
            "src/a/X.luau",
            "src/Shared/Util/init.luau",
        ];
        assert_eq!(
            run(
                &files,
                "src/a/Main.luau",
                SourceKind::Luau,
                &instance(&["^", "X"])
            ),
            ["src/a/X.luau"]
        );
        assert_eq!(
            run(
                &files,
                "src/a/Main.luau",
                SourceKind::Luau,
                &instance(&["^", "^", "Shared", "Util"])
            ),
            ["src/Shared/Util/init.luau"]
        );
    }

    #[test]
    fn roblox_init_scripts_own_their_directory() {
        let files = ["src/Foo/init.luau", "src/Foo/Bar.luau", "src/Baz.luau"];
        assert_eq!(
            run(
                &files,
                "src/Foo/init.luau",
                SourceKind::Luau,
                &instance(&["Bar"])
            ),
            ["src/Foo/Bar.luau"]
        );
        assert_eq!(
            run(
                &files,
                "src/Foo/init.luau",
                SourceKind::Luau,
                &instance(&["^", "Baz"])
            ),
            ["src/Baz.luau"]
        );
        assert_eq!(
            run(
                &files,
                "src/Foo/Bar.luau",
                SourceKind::Luau,
                &instance(&["^"])
            ),
            ["src/Foo/init.luau"]
        );
    }

    #[test]
    fn roblox_script_suffixes_and_both_extensions_are_recognised() {
        let files = ["a/Main.server.lua", "a/Svc.server.luau", "a/Ui.client.lua"];
        for (name, expected) in [("Svc", "a/Svc.server.luau"), ("Ui", "a/Ui.client.lua")] {
            assert_eq!(
                run(
                    &files,
                    "a/Main.server.lua",
                    SourceKind::Lua,
                    &instance(&["^", name])
                ),
                [expected]
            );
        }
    }

    #[test]
    fn roblox_paths_that_leave_the_workspace_or_a_file_do_not_resolve() {
        let files = ["a.luau"];
        assert!(run(&files, "a.luau", SourceKind::Luau, &instance(&["^", "^"])).is_empty());
        assert!(run(&files, "a.luau", SourceKind::Luau, &instance(&["Child"])).is_empty());
        assert!(run(
            &files,
            "a.luau",
            SourceKind::Luau,
            &instance(&["^", "Missing"])
        )
        .is_empty());
    }
}
