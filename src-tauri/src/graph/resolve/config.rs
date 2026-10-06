use std::collections::BTreeSet;
use std::path::Path;

use super::dart::{self, DartPackages};
use super::go::{self, GoModules};
use super::php::{self, Psr4Map};
use super::tsconfig::{self, AliasScopes};
use super::workspace_packages::{self, WorkspacePackages};

pub fn is_resolution_config(rel: &str) -> bool {
    tsconfig::is_config_file(rel)
        || workspace_packages::is_manifest(rel)
        || go::is_manifest(rel)
        || php::is_manifest(rel)
        || dart::is_manifest(rel)
}

/// Everything resolvers learn from project files (`tsconfig.json`,
/// `package.json`, `go.mod`, `composer.json`, `pubspec.yaml`). Editing one of
/// those files reloads this and re-resolves every import.
#[derive(Default)]
pub struct ProjectConfig {
    pub aliases: AliasScopes,
    pub packages: WorkspacePackages,
    pub go_modules: GoModules,
    pub psr4: Psr4Map,
    pub dart_packages: DartPackages,
    pub warnings: Vec<String>,
}

impl ProjectConfig {
    pub fn load(root: &Path, config_files: &BTreeSet<String>) -> Self {
        let select = |is_kind: fn(&str) -> bool| -> Vec<String> {
            config_files
                .iter()
                .filter(|file| is_kind(file))
                .cloned()
                .collect()
        };
        let (aliases, mut warnings) = AliasScopes::load(root, &select(tsconfig::is_config_file));
        let (packages, found) =
            WorkspacePackages::load(root, &select(workspace_packages::is_manifest));
        warnings.extend(found);
        let (go_modules, found) = GoModules::load(root, &select(go::is_manifest));
        warnings.extend(found);
        let (psr4, found) = Psr4Map::load(root, &select(php::is_manifest));
        warnings.extend(found);
        let (dart_packages, found) = DartPackages::load(root, &select(dart::is_manifest));
        warnings.extend(found);
        Self {
            aliases,
            packages,
            go_modules,
            psr4,
            dart_packages,
            warnings,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_every_resolution_config_file() {
        for path in [
            "tsconfig.json",
            "web/tsconfig.app.json",
            "jsconfig.json",
            "package.json",
            "go.mod",
            "svc/go.mod",
            "composer.json",
            "pubspec.yaml",
        ] {
            assert!(is_resolution_config(path), "{path}");
        }
        for path in [
            "go.sum",
            "package-lock.json",
            "composer.lock",
            "pubspec.lock",
            "a.go",
        ] {
            assert!(!is_resolution_config(path), "{path}");
        }
    }
}
