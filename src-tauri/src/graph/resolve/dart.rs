use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use crate::graph::paths;

use super::ResolveContext;

const MANIFEST_FILE: &str = "pubspec.yaml";
const PACKAGE_SCHEME: &str = "package:";
const LIB_DIR: &str = "lib";

pub fn is_manifest(rel: &str) -> bool {
    paths::file_name(rel) == MANIFEST_FILE
}

/// Package names from every `pubspec.yaml`, mapped to the directory holding it.
#[derive(Debug, Default)]
pub struct DartPackages {
    dirs: BTreeMap<String, String>,
}

impl DartPackages {
    pub fn load(root: &Path, manifests: &[String]) -> (Self, Vec<String>) {
        let mut warnings = Vec::new();
        let mut dirs = BTreeMap::new();
        for manifest in manifests {
            match fs::read_to_string(root.join(manifest)) {
                Ok(text) => {
                    if let Some(name) = package_name(&text) {
                        dirs.entry(name)
                            .or_insert_with(|| paths::parent(manifest).to_string());
                    }
                }
                Err(error) => warnings.push(format!("{manifest}: cannot read ({error})")),
            }
        }
        (Self { dirs }, warnings)
    }
}

fn package_name(pubspec: &str) -> Option<String> {
    pubspec.lines().find_map(|line| {
        let value = line.strip_prefix("name:")?;
        let name = value.split('#').next()?.trim().trim_matches(['"', '\'']);
        (!name.is_empty()).then(|| name.to_string())
    })
}

pub(super) fn resolve(from: &str, uri: &str, ctx: &ResolveContext<'_>) -> Option<String> {
    let candidate = if let Some(rest) = uri.strip_prefix(PACKAGE_SCHEME) {
        let (name, path) = rest.split_once('/')?;
        let dir = ctx.config.dart_packages.dirs.get(name)?;
        paths::join(&paths::child(dir, LIB_DIR), path)?
    } else if uri.contains(':') {
        return None;
    } else {
        paths::join(paths::parent(from), uri)?
    };
    (ctx.has_file)(&candidate).then_some(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_top_level_package_name() {
        assert_eq!(
            package_name("name: my_app\nversion: 1.0.0\n").as_deref(),
            Some("my_app")
        );
        assert_eq!(
            package_name("description: x\nname: \"quoted\" # note\n").as_deref(),
            Some("quoted")
        );
        assert_eq!(package_name("dependencies:\n  name: nested\n"), None);
        assert_eq!(package_name("name:\n"), None);
    }

    #[test]
    fn detects_the_manifest_by_file_name() {
        assert!(is_manifest("pubspec.yaml"));
        assert!(is_manifest("packages/a/pubspec.yaml"));
        assert!(!is_manifest("pubspec.lock"));
    }
}
