use std::fs;
use std::path::Path;

use crate::graph::paths;

use super::ResolveContext;

const MANIFEST_FILE: &str = "go.mod";

pub fn is_manifest(rel: &str) -> bool {
    paths::file_name(rel) == MANIFEST_FILE
}

#[derive(Debug, PartialEq, Eq)]
struct GoModule {
    path: String,
    dir: String,
}

/// Every module path declared by a `go.mod`, plus local `replace` targets,
/// longest path first so nested modules win over their parents.
#[derive(Debug, Default)]
pub struct GoModules {
    modules: Vec<GoModule>,
}

impl GoModules {
    pub fn load(root: &Path, manifests: &[String]) -> (Self, Vec<String>) {
        let mut warnings = Vec::new();
        let mut modules = Vec::new();
        for manifest in manifests {
            match fs::read_to_string(root.join(manifest)) {
                Ok(text) => modules.extend(parse_go_mod(&text, paths::parent(manifest))),
                Err(error) => warnings.push(format!("{manifest}: cannot read ({error})")),
            }
        }
        modules.sort_by(|a, b| {
            b.path
                .len()
                .cmp(&a.path.len())
                .then_with(|| a.dir.cmp(&b.dir))
        });
        (Self { modules }, warnings)
    }

    fn package_dir(&self, import_path: &str) -> Option<String> {
        self.modules.iter().find_map(|module| {
            let rest = import_path.strip_prefix(&module.path)?;
            if rest.is_empty() {
                return Some(module.dir.clone());
            }
            paths::join(&module.dir, rest.strip_prefix('/')?)
        })
    }
}

/// An import names a package, which is a directory of files, so it links to
/// every non-test file in that directory: a change to any of them can reach the
/// importer, which a single representative file would hide from blast radius.
pub(super) fn resolve(path: &str, ctx: &ResolveContext<'_>) -> Vec<String> {
    ctx.config
        .go_modules
        .package_dir(path)
        .map(|dir| ctx.declared.go_package(&dir).to_vec())
        .unwrap_or_default()
}

fn parse_go_mod(text: &str, dir: &str) -> Vec<GoModule> {
    let mut modules = Vec::new();
    let mut in_replace_block = false;
    for raw in text.lines() {
        let line = raw.split("//").next().unwrap_or("").trim();
        if in_replace_block {
            if line == ")" {
                in_replace_block = false;
            } else {
                modules.extend(replacement(line, dir));
            }
        } else if let Some(rest) = directive(line, "module") {
            modules.push(GoModule {
                path: unquote(rest).to_string(),
                dir: dir.to_string(),
            });
        } else if let Some(rest) = directive(line, "replace") {
            if rest == "(" {
                in_replace_block = true;
            } else {
                modules.extend(replacement(rest, dir));
            }
        }
    }
    modules
}

fn directive<'a>(line: &'a str, name: &str) -> Option<&'a str> {
    line.strip_prefix(name)
        .filter(|rest| rest.starts_with(char::is_whitespace))
        .map(str::trim)
}

fn replacement(line: &str, dir: &str) -> Option<GoModule> {
    let (old, new) = line.split_once("=>")?;
    let target = new.split_whitespace().next()?;
    if !target.starts_with('.') {
        return None;
    }
    Some(GoModule {
        path: unquote(old.split_whitespace().next()?).to_string(),
        dir: paths::join(dir, unquote(target))?,
    })
}

fn unquote(text: &str) -> &str {
    text.trim_matches(['"', '`'])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn module(path: &str, dir: &str) -> GoModule {
        GoModule {
            path: path.into(),
            dir: dir.into(),
        }
    }

    fn modules(entries: &[(&str, &str)]) -> GoModules {
        GoModules {
            modules: entries
                .iter()
                .map(|(path, dir)| module(path, dir))
                .collect(),
        }
    }

    #[test]
    fn reads_the_module_line_in_every_spelling() {
        assert_eq!(
            parse_go_mod("module example.com/app\n\ngo 1.22\n", ""),
            vec![module("example.com/app", "")]
        );
        assert_eq!(
            parse_go_mod("module \"example.com/q\" // trailing\n", "svc"),
            vec![module("example.com/q", "svc")]
        );
        assert!(parse_go_mod("go 1.22\nrequire x v1\n", "").is_empty());
    }

    #[test]
    fn reads_local_replace_directives_in_single_and_block_form() {
        let text = "module m\nreplace a.io/x => ../x\nreplace (\n  b.io/y v1.0.0 => ./third/y\n  c.io/z => github.com/fork/z v2\n)\n";
        assert_eq!(
            parse_go_mod(text, "app"),
            vec![
                module("m", "app"),
                module("a.io/x", "x"),
                module("b.io/y", "app/third/y"),
            ]
        );
    }

    #[test]
    fn maps_import_paths_to_package_directories() {
        let index = modules(&[("example.com/app/sub", "sub"), ("example.com/app", "")]);
        assert_eq!(index.package_dir("example.com/app").as_deref(), Some(""));
        assert_eq!(
            index.package_dir("example.com/app/internal/db").as_deref(),
            Some("internal/db")
        );
        assert_eq!(
            index.package_dir("example.com/app/sub/x").as_deref(),
            Some("sub/x")
        );
        assert_eq!(index.package_dir("example.com/application"), None);
        assert_eq!(index.package_dir("fmt"), None);
    }

    #[test]
    fn detects_the_manifest_by_file_name() {
        assert!(is_manifest("go.mod"));
        assert!(is_manifest("svc/go.mod"));
        assert!(!is_manifest("go.sum"));
    }
}
