use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde_json::{Map, Value};

use crate::graph::paths;

use super::tsconfig::AliasRule;

const MANIFEST_FILE: &str = "package.json";
const SOURCE_FALLBACKS: [&str; 2] = ["src/index", "index"];
const ENTRY_FIELDS: [&str; 5] = ["source", "types", "typings", "module", "main"];
const EXPORT_CONDITIONS: [&str; 5] = ["types", "import", "module", "default", "require"];
const MAX_CONDITION_DEPTH: usize = 4;

pub fn is_manifest(rel: &str) -> bool {
    paths::file_name(rel) == MANIFEST_FILE
}

#[derive(Debug)]
struct Package {
    dir: String,
    entries: Vec<String>,
    subpaths: Vec<AliasRule>,
}

#[derive(Debug, Default)]
pub struct WorkspacePackages {
    packages: BTreeMap<String, Package>,
}

impl WorkspacePackages {
    pub fn load(root: &Path, manifests: &[String]) -> (Self, Vec<String>) {
        let mut warnings = Vec::new();
        let mut packages = BTreeMap::new();
        for manifest in manifests {
            match read_package(root, manifest) {
                Ok(Some((name, package))) => {
                    packages.entry(name).or_insert(package);
                }
                Ok(None) => {}
                Err(message) => warnings.push(format!("{manifest}: {message}")),
            }
        }
        (Self { packages }, warnings)
    }

    pub fn candidates(&self, specifier: &str) -> Vec<String> {
        let Some((name, subpath)) = split_package_name(specifier) else {
            return Vec::new();
        };
        let Some(package) = self.packages.get(name) else {
            return Vec::new();
        };
        if subpath.is_empty() {
            return package.root_candidates();
        }
        package.subpath_candidates(subpath)
    }
}

impl Package {
    fn root_candidates(&self) -> Vec<String> {
        let declared = self
            .entries
            .iter()
            .filter_map(|entry| paths::join(&self.dir, entry));
        let fallbacks = SOURCE_FALLBACKS
            .iter()
            .filter_map(|entry| paths::join(&self.dir, entry));
        declared.chain(fallbacks).collect()
    }

    fn subpath_candidates(&self, subpath: &str) -> Vec<String> {
        let key = format!("./{subpath}");
        let mapped = self
            .subpaths
            .iter()
            .filter_map(|rule| rule.capture(&key).map(|captured| (rule, captured)))
            .max_by_key(|(rule, _)| rule.prefix.len())
            .into_iter()
            .flat_map(|(rule, captured)| {
                rule.targets.iter().filter_map(move |target| {
                    paths::join(&self.dir, &target.replace('*', captured))
                })
            });
        let conventional = [subpath.to_string(), format!("src/{subpath}")]
            .into_iter()
            .filter_map(|path| paths::join(&self.dir, &path));
        mapped.chain(conventional).collect()
    }
}

fn split_package_name(specifier: &str) -> Option<(&str, &str)> {
    if specifier.starts_with('.') || specifier.starts_with('/') {
        return None;
    }
    let name_end = if specifier.starts_with('@') {
        let scope_end = specifier.find('/')?;
        specifier[scope_end + 1..]
            .find('/')
            .map_or(specifier.len(), |offset| scope_end + 1 + offset)
    } else {
        specifier.find('/').unwrap_or(specifier.len())
    };
    let (name, rest) = specifier.split_at(name_end);
    Some((name, rest.trim_start_matches('/')))
}

fn read_package(root: &Path, manifest: &str) -> Result<Option<(String, Package)>, String> {
    let text = fs::read_to_string(root.join(manifest))
        .map_err(|error| format!("cannot read ({error})"))?;
    let json: Value =
        serde_json::from_str(&text).map_err(|error| format!("invalid JSON ({error})"))?;
    let Some(name) = json.get("name").and_then(Value::as_str) else {
        return Ok(None);
    };
    let package = Package {
        dir: paths::parent(manifest).to_string(),
        entries: entry_candidates(&json),
        subpaths: subpath_rules(&json),
    };
    Ok(Some((name.to_string(), package)))
}

fn entry_candidates(json: &Value) -> Vec<String> {
    let mut found = Vec::new();
    if let Some(exports) = json.get("exports") {
        collect_targets(exports, &mut found, 0);
    }
    for field in ENTRY_FIELDS {
        if let Some(Value::String(path)) = json.get(field) {
            found.push(path.clone());
        }
    }
    found
}

fn collect_targets(value: &Value, out: &mut Vec<String>, depth: usize) {
    if depth > MAX_CONDITION_DEPTH {
        return;
    }
    match value {
        Value::String(path) => out.push(path.clone()),
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect_targets(item, out, depth + 1)),
        Value::Object(map) => collect_object_targets(map, out, depth),
        _ => {}
    }
}

fn collect_object_targets(map: &Map<String, Value>, out: &mut Vec<String>, depth: usize) {
    if let Some(root) = map.get(".") {
        collect_targets(root, out, depth + 1);
        return;
    }
    if map.keys().any(|key| key.starts_with('.')) {
        return;
    }
    for condition in EXPORT_CONDITIONS {
        if let Some(target) = map.get(condition) {
            collect_targets(target, out, depth + 1);
        }
    }
}

fn subpath_rules(json: &Value) -> Vec<AliasRule> {
    let Some(Value::Object(exports)) = json.get("exports") else {
        return Vec::new();
    };
    exports
        .iter()
        .filter(|(key, _)| key.starts_with("./"))
        .filter_map(|(key, value)| {
            let mut targets = Vec::new();
            collect_targets(value, &mut targets, 0);
            AliasRule::parse(key, targets)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load(files: &[(&str, &str)]) -> (WorkspacePackages, Vec<String>, tempfile::TempDir) {
        let dir = tempfile::Builder::new()
            .prefix("flare-pkgs-")
            .tempdir()
            .unwrap();
        for (path, content) in files {
            let full = dir.path().join(path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, content).unwrap();
        }
        let manifests: Vec<String> = files
            .iter()
            .map(|(path, _)| (*path).to_string())
            .filter(|path| is_manifest(path))
            .collect();
        let (packages, warnings) = WorkspacePackages::load(dir.path(), &manifests);
        (packages, warnings, dir)
    }

    #[test]
    fn recognises_manifest_file_names() {
        assert!(is_manifest("package.json"));
        assert!(is_manifest("packages/a/package.json"));
        assert!(!is_manifest("package-lock.json"));
        assert!(!is_manifest("tsconfig.json"));
    }

    #[test]
    fn splits_scoped_and_unscoped_package_names() {
        assert_eq!(
            split_package_name("@flare/protocol"),
            Some(("@flare/protocol", ""))
        );
        assert_eq!(
            split_package_name("@flare/protocol/utils/x"),
            Some(("@flare/protocol", "utils/x"))
        );
        assert_eq!(split_package_name("zod"), Some(("zod", "")));
        assert_eq!(split_package_name("lodash/fp"), Some(("lodash", "fp")));
        assert_eq!(split_package_name("@scope"), None);
        assert_eq!(split_package_name("./local"), None);
        assert_eq!(split_package_name("/abs"), None);
    }

    #[test]
    fn root_entry_comes_from_exports_main_and_fallbacks() {
        let (packages, warnings, _dir) = load(&[(
            "protocol/package.json",
            r#"{ "name": "@flare/protocol", "exports": { ".": "./src/main.ts" }, "main": "dist/index.js" }"#,
        )]);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(
            packages.candidates("@flare/protocol"),
            [
                "protocol/src/main.ts",
                "protocol/dist/index.js",
                "protocol/src/index",
                "protocol/index"
            ]
        );
    }

    #[test]
    fn exports_conditions_prefer_types_then_import_then_default() {
        let (packages, _, _dir) = load(&[(
            "pkg/package.json",
            r#"{ "name": "pkg", "exports": { ".": { "default": "./d.js", "import": "./i.js", "types": "./t.d.ts" } } }"#,
        )]);
        assert_eq!(
            &packages.candidates("pkg")[..3],
            ["pkg/t.d.ts", "pkg/i.js", "pkg/d.js"]
        );
    }

    #[test]
    fn conditions_without_a_dot_key_are_the_root_export() {
        let (packages, _, _dir) = load(&[(
            "p/package.json",
            r#"{ "name": "p", "exports": { "import": "./esm.js" } }"#,
        )]);
        assert_eq!(packages.candidates("p")[0], "p/esm.js");
    }

    #[test]
    fn subpath_only_exports_do_not_invent_a_root_entry() {
        let (packages, _, _dir) = load(&[(
            "p/package.json",
            r#"{ "name": "p", "exports": { "./x": "./src/x.ts" } }"#,
        )]);
        assert_eq!(packages.candidates("p"), ["p/src/index", "p/index"]);
    }

    #[test]
    fn subpaths_use_export_maps_then_conventional_locations() {
        let (packages, _, _dir) = load(&[(
            "p/package.json",
            r#"{ "name": "@s/p", "exports": { "./util": "./lib/util.ts", "./feat/*": "./src/features/*/index.ts" } }"#,
        )]);
        assert_eq!(packages.candidates("@s/p/util")[0], "p/lib/util.ts");
        assert_eq!(
            packages.candidates("@s/p/feat/chat")[0],
            "p/src/features/chat/index.ts"
        );
        assert_eq!(
            packages.candidates("@s/p/other"),
            ["p/other", "p/src/other"]
        );
    }

    #[test]
    fn unknown_packages_and_relative_specifiers_have_no_candidates() {
        let (packages, _, _dir) = load(&[("p/package.json", r#"{ "name": "p" }"#)]);
        assert!(packages.candidates("react").is_empty());
        assert!(packages.candidates("./p").is_empty());
    }

    #[test]
    fn root_package_files_map_to_the_workspace_root() {
        let (packages, _, _dir) =
            load(&[("package.json", r#"{ "name": "app", "main": "src/app.ts" }"#)]);
        assert_eq!(packages.candidates("app")[0], "src/app.ts");
        assert_eq!(packages.candidates("app/util"), ["util", "src/util"]);
    }

    #[test]
    fn manifests_without_a_name_are_skipped_and_invalid_ones_reported() {
        let (packages, warnings, _dir) = load(&[
            ("a/package.json", r#"{ "private": true }"#),
            ("b/package.json", "{ nope"),
        ]);
        assert!(packages.packages.is_empty());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].starts_with("b/package.json: invalid JSON"));
    }

    #[test]
    fn the_first_manifest_wins_a_duplicate_name() {
        let (packages, _, _dir) = load(&[
            ("a/package.json", r#"{ "name": "dup", "main": "a.ts" }"#),
            ("b/package.json", r#"{ "name": "dup", "main": "b.ts" }"#),
        ]);
        assert_eq!(packages.candidates("dup")[0], "a/a.ts");
    }
}
