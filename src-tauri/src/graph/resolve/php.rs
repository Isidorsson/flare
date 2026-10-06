use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::graph::paths;

use super::ResolveContext;

const MANIFEST_FILE: &str = "composer.json";
const AUTOLOAD_SECTIONS: [&str; 2] = ["autoload", "autoload-dev"];
const PSR4_KEY: &str = "psr-4";
const NAMESPACE_SEPARATOR: char = '\\';
const SOURCE_EXTENSION: &str = ".php";

type HasFile<'a> = &'a dyn Fn(&str) -> bool;

pub fn is_manifest(rel: &str) -> bool {
    paths::file_name(rel) == MANIFEST_FILE
}

#[derive(Debug, PartialEq, Eq)]
struct Psr4Entry {
    prefix: String,
    dir: String,
}

/// PSR-4 namespace prefixes from every `composer.json`, longest prefix first.
#[derive(Debug, Default)]
pub struct Psr4Map {
    entries: Vec<Psr4Entry>,
}

impl Psr4Map {
    pub fn load(root: &Path, manifests: &[String]) -> (Self, Vec<String>) {
        let mut warnings = Vec::new();
        let mut entries = Vec::new();
        for manifest in manifests {
            match read_entries(root, manifest) {
                Ok(found) => entries.extend(found),
                Err(message) => warnings.push(format!("{manifest}: {message}")),
            }
        }
        entries.sort_by(|a, b| {
            b.prefix
                .len()
                .cmp(&a.prefix.len())
                .then_with(|| a.dir.cmp(&b.dir))
        });
        (Self { entries }, warnings)
    }

    fn candidates(&self, class: &str) -> Vec<String> {
        self.entries
            .iter()
            .filter_map(|entry| {
                let rest = class.strip_prefix(&entry.prefix)?;
                let file = format!(
                    "{}{SOURCE_EXTENSION}",
                    rest.replace(NAMESPACE_SEPARATOR, "/")
                );
                paths::join(&entry.dir, &file)
            })
            .collect()
    }
}

fn read_entries(root: &Path, manifest: &str) -> Result<Vec<Psr4Entry>, String> {
    let text = fs::read_to_string(root.join(manifest))
        .map_err(|error| format!("cannot read ({error})"))?;
    let json: Value =
        serde_json::from_str(&text).map_err(|error| format!("invalid JSON ({error})"))?;
    let base = paths::parent(manifest);
    let mut entries = Vec::new();
    for section in AUTOLOAD_SECTIONS {
        let Some(map) = json
            .get(section)
            .and_then(|autoload| autoload.get(PSR4_KEY))
            .and_then(Value::as_object)
        else {
            continue;
        };
        for (prefix, target) in map {
            entries.extend(entries_for(prefix, target, base));
        }
    }
    Ok(entries)
}

fn entries_for(prefix: &str, target: &Value, base: &str) -> Vec<Psr4Entry> {
    let dirs: Vec<&str> = match target {
        Value::String(dir) => vec![dir.as_str()],
        Value::Array(items) => items.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    let prefix = normalise_prefix(prefix);
    dirs.into_iter()
        .filter_map(|dir| paths::join(base, dir))
        .map(|dir| Psr4Entry {
            prefix: prefix.clone(),
            dir,
        })
        .collect()
}

fn normalise_prefix(prefix: &str) -> String {
    if prefix.is_empty() || prefix.ends_with(NAMESPACE_SEPARATOR) {
        prefix.to_string()
    } else {
        format!("{prefix}{NAMESPACE_SEPARATOR}")
    }
}

/// A literal include is relative to the including file (which is what
/// `__DIR__` anchors mean), then to the workspace root.
pub(super) fn resolve_include(from: &str, path: &str, has_file: HasFile<'_>) -> Option<String> {
    if paths::is_absolute(path) {
        return None;
    }
    [paths::parent(from), ""]
        .into_iter()
        .filter_map(|dir| paths::join(dir, path))
        .find(|candidate| has_file(candidate))
}

pub(super) fn resolve_use(name: &str, ctx: &ResolveContext<'_>) -> Option<String> {
    ctx.config
        .psr4
        .candidates(name)
        .into_iter()
        .find(|candidate| (ctx.has_file)(candidate))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn map(entries: &[(&str, &str)]) -> Psr4Map {
        Psr4Map {
            entries: entries
                .iter()
                .map(|(prefix, dir)| Psr4Entry {
                    prefix: (*prefix).into(),
                    dir: (*dir).into(),
                })
                .collect(),
        }
    }

    #[test]
    fn maps_class_names_to_psr4_files_longest_prefix_first() {
        let index = map(&[("App\\Models\\", "src/models"), ("App\\", "src")]);
        assert_eq!(
            index.candidates("App\\Models\\User"),
            ["src/models/User.php", "src/Models/User.php"]
        );
        assert_eq!(
            index.candidates("App\\Http\\Kernel"),
            ["src/Http/Kernel.php"]
        );
        assert!(index.candidates("Vendor\\Pkg\\X").is_empty());
    }

    #[test]
    fn prefixes_are_normalised_to_end_with_a_separator() {
        assert_eq!(normalise_prefix("App"), "App\\");
        assert_eq!(normalise_prefix("App\\"), "App\\");
        assert_eq!(normalise_prefix(""), "");
    }

    #[test]
    fn string_and_array_targets_are_both_read() {
        let one = entries_for("A\\", &Value::String("src/".into()), "pkg");
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].dir, "pkg/src");
        let many: Value = serde_json::json!(["src/", "lib/"]);
        assert_eq!(entries_for("A\\", &many, "").len(), 2);
    }

    #[test]
    fn includes_resolve_beside_the_file_then_from_the_root() {
        let files: HashSet<&str> = ["inc/a.php", "lib/b.php", "root.php"].into();
        let has_file = |path: &str| files.contains(path);
        assert_eq!(
            resolve_include("inc/main.php", "a.php", &has_file).as_deref(),
            Some("inc/a.php")
        );
        assert_eq!(
            resolve_include("inc/main.php", "../lib/b.php", &has_file).as_deref(),
            Some("lib/b.php")
        );
        assert_eq!(
            resolve_include("inc/main.php", "root.php", &has_file).as_deref(),
            Some("root.php")
        );
        assert_eq!(
            resolve_include("inc/main.php", "/etc/x.php", &has_file),
            None
        );
    }
}
