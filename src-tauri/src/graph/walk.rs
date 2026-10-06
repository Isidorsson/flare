use std::collections::HashMap;
use std::path::{Path, PathBuf};

use ignore::gitignore::Gitignore;
use ignore::{DirEntry, Match, WalkBuilder};

use super::lang::SourceKind;
use super::paths;
use super::resolve::is_resolution_config;

pub const GITIGNORE_FILE: &str = ".gitignore";
const SKIPPED_DIRS: [&str; 3] = ["node_modules", "__pycache__", "site-packages"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFile {
    pub path: String,
    pub kind: SourceKind,
}

#[derive(Debug, Default)]
pub struct Scan {
    pub sources: Vec<SourceFile>,
    pub configs: Vec<String>,
    pub warnings: Vec<String>,
}

pub fn scan(root: &Path) -> Scan {
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .ignore(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .parents(false)
        .require_git(false)
        .follow_links(false)
        .filter_entry(|entry| !is_skipped_dir(entry))
        .build();
    let mut scan = Scan::default();
    for entry in walker {
        match entry {
            Ok(entry) => record(root, &entry, &mut scan),
            Err(error) => scan.warnings.push(error.to_string()),
        }
    }
    scan.sources.sort_by(|a, b| a.path.cmp(&b.path));
    scan.configs.sort();
    scan
}

fn is_skipped_dir(entry: &DirEntry) -> bool {
    entry.depth() > 0
        && entry.file_type().is_some_and(|kind| kind.is_dir())
        && entry
            .file_name()
            .to_str()
            .is_some_and(|name| SKIPPED_DIRS.contains(&name))
}

fn record(root: &Path, entry: &DirEntry, scan: &mut Scan) {
    if !entry.file_type().is_some_and(|kind| kind.is_file()) {
        return;
    }
    let Ok(relative) = entry.path().strip_prefix(root) else {
        scan.warnings.push(format!(
            "{} is outside the workspace",
            entry.path().display()
        ));
        return;
    };
    let path = paths::normalize_separators(&relative.to_string_lossy());
    if let Some(kind) = SourceKind::from_path(&path) {
        scan.sources.push(SourceFile { path, kind });
    } else if is_resolution_config(&path) {
        scan.configs.push(path);
    }
}

pub struct IgnoreRules {
    root: PathBuf,
    matchers: HashMap<String, Option<Gitignore>>,
    warnings: Vec<String>,
}

impl IgnoreRules {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            matchers: HashMap::new(),
            warnings: Vec::new(),
        }
    }

    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    pub fn is_ignored(&mut self, rel: &str) -> bool {
        if has_skipped_segment(rel) {
            return true;
        }
        for dir in paths::ancestor_dirs(paths::parent(rel)) {
            let Some(matcher) = self.matcher(dir) else {
                continue;
            };
            let within = rel
                .strip_prefix(dir)
                .map_or(rel, |rest| rest.trim_start_matches('/'));
            match matcher.matched_path_or_any_parents(within, false) {
                Match::Ignore(_) => return true,
                Match::Whitelist(_) => return false,
                Match::None => {}
            }
        }
        false
    }

    fn matcher(&mut self, dir: &str) -> Option<&Gitignore> {
        let Self {
            root,
            matchers,
            warnings,
        } = self;
        matchers
            .entry(dir.to_string())
            .or_insert_with(|| load_matcher(root, dir, warnings))
            .as_ref()
    }
}

fn has_skipped_segment(rel: &str) -> bool {
    rel.split('/')
        .any(|segment| segment.starts_with('.') || SKIPPED_DIRS.contains(&segment))
}

fn load_matcher(root: &Path, dir: &str, warnings: &mut Vec<String>) -> Option<Gitignore> {
    let file = root.join(dir).join(GITIGNORE_FILE);
    if !file.is_file() {
        return None;
    }
    let (matcher, error) = Gitignore::new(&file);
    if let Some(error) = error {
        warnings.push(format!("{}: {error}", paths::child(dir, GITIGNORE_FILE)));
    }
    Some(matcher)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn fixture(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::Builder::new()
            .prefix("flare-walk-")
            .tempdir()
            .unwrap();
        for (path, content) in files {
            let full = dir.path().join(path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, content).unwrap();
        }
        dir
    }

    fn source_paths(scan: &Scan) -> Vec<&str> {
        scan.sources.iter().map(|file| file.path.as_str()).collect()
    }

    const TREE: [(&str, &str); 11] = [
        (".gitignore", "dist/\n*.generated.ts\n!keep.generated.ts\n"),
        ("src/a.ts", ""),
        ("src/b.py", ""),
        ("src/lib.rs", ""),
        ("src/x.generated.ts", ""),
        ("src/keep.generated.ts", ""),
        ("dist/out.js", ""),
        ("node_modules/pkg/index.js", ""),
        (".hidden/secret.ts", ""),
        ("pkg/.gitignore", "local.ts\n"),
        ("pkg/local.ts", ""),
    ];

    #[test]
    fn scan_respects_gitignore_hidden_and_vendored_directories() {
        let dir = fixture(&TREE);
        let result = scan(dir.path());
        assert_eq!(
            source_paths(&result),
            [
                "src/a.ts",
                "src/b.py",
                "src/keep.generated.ts",
                "src/lib.rs"
            ]
        );
        assert!(result.warnings.is_empty(), "{:?}", result.warnings);
    }

    #[test]
    fn scan_collects_tsconfigs_and_package_manifests_but_not_vendored_ones() {
        let dir = fixture(&[
            ("tsconfig.json", "{}"),
            ("web/tsconfig.app.json", "{}"),
            ("package.json", "{}"),
            ("web/package.json", "{}"),
            ("package-lock.json", "{}"),
            ("node_modules/x/tsconfig.json", "{}"),
            ("node_modules/x/package.json", "{}"),
        ]);
        let result = scan(dir.path());
        assert_eq!(
            result.configs,
            [
                "package.json",
                "tsconfig.json",
                "web/package.json",
                "web/tsconfig.app.json"
            ]
        );
    }

    #[test]
    fn scan_works_without_a_git_repository() {
        let dir = fixture(&[
            (".gitignore", "ignored.ts\n"),
            ("ignored.ts", ""),
            ("kept.ts", ""),
        ]);
        assert_eq!(source_paths(&scan(dir.path())), ["kept.ts"]);
    }

    #[test]
    fn ignore_rules_agree_with_the_scan_for_every_file() {
        let dir = fixture(&TREE);
        let scanned: Vec<String> = scan(dir.path())
            .sources
            .into_iter()
            .map(|file| file.path)
            .collect();
        let mut rules = IgnoreRules::new(dir.path());
        for (path, _) in TREE
            .iter()
            .filter(|(path, _)| SourceKind::from_path(path).is_some())
        {
            let tracked = scanned.iter().any(|known| known == path);
            assert_eq!(tracked, !rules.is_ignored(path), "{path}");
        }
    }

    #[test]
    fn ignore_rules_apply_nested_gitignores_and_whitelists() {
        let dir = fixture(&TREE);
        let mut rules = IgnoreRules::new(dir.path());
        assert!(rules.is_ignored("dist/out.js"));
        assert!(rules.is_ignored("dist/deep/er/out.js"));
        assert!(rules.is_ignored("src/x.generated.ts"));
        assert!(!rules.is_ignored("src/keep.generated.ts"));
        assert!(rules.is_ignored("pkg/local.ts"));
        assert!(!rules.is_ignored("local.ts"));
        assert!(rules.is_ignored("node_modules/pkg/index.js"));
        assert!(rules.is_ignored(".hidden/secret.ts"));
        assert!(!rules.is_ignored("src/a.ts"));
    }

    #[test]
    fn rules_are_cached_per_directory_until_the_index_is_rebuilt() {
        let dir = fixture(&[(".gitignore", ""), ("a.ts", "")]);
        let mut rules = IgnoreRules::new(dir.path());
        assert!(!rules.is_ignored("a.ts"));
        fs::write(dir.path().join(".gitignore"), "a.ts\n").unwrap();
        assert!(!rules.is_ignored("a.ts"));
        assert!(IgnoreRules::new(dir.path()).is_ignored("a.ts"));
    }
}
