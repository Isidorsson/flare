use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use ignore::gitignore::{Gitignore, GitignoreBuilder};

use super::sandbox::GIT_DIR;

const GITIGNORE_FILE: &str = ".gitignore";

type DirRules = Option<Arc<Gitignore>>;

/// Decides whether a path is hidden by git ignore rules, the way `git status`
/// would see it: every `.gitignore` between the repository root and the path
/// applies, deeper files win, and an ignored directory hides its whole subtree.
#[derive(Debug)]
pub struct IgnoreMatcher {
    base: PathBuf,
    exclude: DirRules,
    rules_by_dir: Mutex<HashMap<PathBuf, DirRules>>,
}

impl IgnoreMatcher {
    pub fn new(workspace_root: &Path) -> Self {
        let base = find_repository_root(workspace_root);
        let exclude = load_rules(&base, &base.join(GIT_DIR).join("info").join("exclude"));
        Self {
            base,
            exclude,
            rules_by_dir: Mutex::new(HashMap::new()),
        }
    }

    pub fn invalidate(&self) {
        self.lock().clear();
    }

    pub fn is_ignored(&self, path: &Path, is_dir: bool) -> bool {
        let Ok(relative) = path.strip_prefix(&self.base) else {
            return false;
        };
        let count = relative.components().count();
        let mut current = self.base.clone();
        for (index, component) in relative.components().enumerate() {
            current.push(component);
            if component.as_os_str() == GIT_DIR {
                return true;
            }
            let is_last = index + 1 == count;
            if self.is_hidden_by_rules(&current, !is_last || is_dir) {
                return true;
            }
        }
        false
    }

    fn is_hidden_by_rules(&self, path: &Path, is_dir: bool) -> bool {
        let deepest_first = path.parent().into_iter().flat_map(Path::ancestors);
        for dir in deepest_first.take_while(|dir| dir.starts_with(&self.base)) {
            let Some(rules) = self.rules_for(dir) else {
                continue;
            };
            let verdict = rules.matched(path, is_dir);
            if verdict.is_ignore() {
                return true;
            }
            if verdict.is_whitelist() {
                return false;
            }
        }
        self.exclude
            .as_ref()
            .is_some_and(|rules| rules.matched(path, is_dir).is_ignore())
    }

    fn rules_for(&self, dir: &Path) -> DirRules {
        if let Some(cached) = self.lock().get(dir) {
            return cached.clone();
        }
        let loaded = load_rules(dir, &dir.join(GITIGNORE_FILE));
        self.lock().insert(dir.to_path_buf(), loaded.clone());
        loaded
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, DirRules>> {
        self.rules_by_dir
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

fn find_repository_root(workspace_root: &Path) -> PathBuf {
    workspace_root
        .ancestors()
        .find(|dir| dir.join(GIT_DIR).exists())
        .unwrap_or(workspace_root)
        .to_path_buf()
}

fn load_rules(dir: &Path, file: &Path) -> DirRules {
    if !file.is_file() {
        return None;
    }
    let mut builder = GitignoreBuilder::new(dir);
    if let Some(partial) = builder.add(file) {
        eprintln!(
            "flare: some rules in {} were skipped: {partial}",
            file.display()
        );
    }
    match builder.build() {
        Ok(rules) => Some(Arc::new(rules)),
        Err(error) => {
            eprintln!("flare: ignoring unreadable {}: {error}", file.display());
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        fs::write(path, content).expect("write");
    }

    fn repo(files: &[(&str, &str)]) -> (tempfile::TempDir, PathBuf, IgnoreMatcher) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        fs::create_dir_all(root.join(".git")).expect("git dir");
        for (path, content) in files {
            write(&root, path, content);
        }
        let matcher = IgnoreMatcher::new(&root);
        (dir, root, matcher)
    }

    #[test]
    fn applies_root_gitignore_to_files_and_directories() {
        let (_dir, root, matcher) = repo(&[(".gitignore", "node_modules/\n*.log\n")]);
        assert!(matcher.is_ignored(&root.join("node_modules"), true));
        assert!(matcher.is_ignored(&root.join("node_modules/react/index.js"), false));
        assert!(matcher.is_ignored(&root.join("debug.log"), false));
        assert!(!matcher.is_ignored(&root.join("src/index.ts"), false));
    }

    #[test]
    fn directory_only_patterns_ignore_files_with_the_same_name() {
        let (_dir, root, matcher) = repo(&[(".gitignore", "build/\n")]);
        assert!(!matcher.is_ignored(&root.join("build"), false));
        assert!(matcher.is_ignored(&root.join("build"), true));
    }

    #[test]
    fn nested_gitignore_overrides_the_parent() {
        let (_dir, root, matcher) = repo(&[
            (".gitignore", "*.gen.ts\n"),
            ("pkg/.gitignore", "!keep.gen.ts\nlocal.txt\n"),
        ]);
        assert!(matcher.is_ignored(&root.join("a.gen.ts"), false));
        assert!(!matcher.is_ignored(&root.join("pkg/keep.gen.ts"), false));
        assert!(matcher.is_ignored(&root.join("pkg/other.gen.ts"), false));
        assert!(matcher.is_ignored(&root.join("pkg/local.txt"), false));
        assert!(!matcher.is_ignored(&root.join("local.txt"), false));
    }

    #[test]
    fn cannot_reinclude_files_under_an_ignored_directory() {
        let (_dir, root, matcher) = repo(&[(".gitignore", "dist/\n!dist/keep.js\n")]);
        assert!(matcher.is_ignored(&root.join("dist/keep.js"), false));
    }

    #[test]
    fn always_hides_the_git_directory() {
        let (_dir, root, matcher) = repo(&[]);
        assert!(matcher.is_ignored(&root.join(".git"), true));
        assert!(matcher.is_ignored(&root.join(".git/HEAD"), false));
        assert!(matcher.is_ignored(&root.join("sub/.git/config"), false));
    }

    #[test]
    fn honours_info_exclude() {
        let (_dir, root, matcher) = repo(&[(".git/info/exclude", "scratch.txt\n")]);
        assert!(matcher.is_ignored(&root.join("scratch.txt"), false));
    }

    #[test]
    fn workspace_inside_a_repository_inherits_parent_rules() {
        let (_dir, root, _) = repo(&[(".gitignore", "secret.txt\n")]);
        write(&root, "app/main.rs", "");
        let matcher = IgnoreMatcher::new(&root.join("app"));
        assert!(matcher.is_ignored(&root.join("app/secret.txt"), false));
        assert!(!matcher.is_ignored(&root.join("app/main.rs"), false));
    }

    #[test]
    fn works_without_a_git_repository() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        write(&root, ".gitignore", "tmp/\n");
        let matcher = IgnoreMatcher::new(&root);
        assert!(matcher.is_ignored(&root.join("tmp/x"), false));
    }

    #[test]
    fn invalidate_picks_up_edited_gitignore_files() {
        let (_dir, root, matcher) = repo(&[(".gitignore", "a.txt\n")]);
        assert!(matcher.is_ignored(&root.join("a.txt"), false));
        write(&root, ".gitignore", "b.txt\n");
        assert!(matcher.is_ignored(&root.join("a.txt"), false));
        matcher.invalidate();
        assert!(!matcher.is_ignored(&root.join("a.txt"), false));
        assert!(matcher.is_ignored(&root.join("b.txt"), false));
    }

    #[test]
    fn paths_outside_the_base_are_not_ignored() {
        let (_dir, _root, matcher) = repo(&[(".gitignore", "*\n")]);
        let other = tempfile::tempdir().expect("other");
        assert!(!matcher.is_ignored(&other.path().join("x"), false));
    }
}
