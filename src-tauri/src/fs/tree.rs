use std::cmp::Ordering;
use std::fs;
use std::path::Path;

use serde::Serialize;

use super::error::FsError;
use super::ignore_rules::IgnoreMatcher;
use super::sandbox::to_wire;

pub const MAX_DIR_ENTRIES: usize = 5_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub entries: Vec<DirEntryInfo>,
    pub truncated: bool,
}

pub fn list_dir(dir: &Path, matcher: &IgnoreMatcher) -> Result<DirListing, FsError> {
    let metadata = fs::metadata(dir).map_err(|e| FsError::io(dir, e))?;
    if !metadata.is_dir() {
        return Err(FsError::NotADirectory(dir.display().to_string()));
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| FsError::io(dir, e))? {
        let entry = entry.map_err(|e| FsError::io(dir, e))?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|e| FsError::io(&path, e))?;
        let kind = if file_type.is_dir() {
            EntryKind::Dir
        } else {
            EntryKind::File
        };
        if matcher.is_ignored(&path, kind == EntryKind::Dir) {
            continue;
        }
        entries.push(DirEntryInfo {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: to_wire(&path),
            kind,
        });
    }
    entries.sort_by(compare_entries);
    let truncated = entries.len() > MAX_DIR_ENTRIES;
    entries.truncate(MAX_DIR_ENTRIES);
    Ok(DirListing { entries, truncated })
}

fn compare_entries(a: &DirEntryInfo, b: &DirEntryInfo) -> Ordering {
    let by_kind = (a.kind == EntryKind::File).cmp(&(b.kind == EntryKind::File));
    by_kind
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        .then_with(|| a.name.cmp(&b.name))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        _dir: tempfile::TempDir,
        root: std::path::PathBuf,
        matcher: IgnoreMatcher,
    }

    fn fixture(files: &[&str]) -> Fixture {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        fs::create_dir_all(root.join(".git")).expect("git dir");
        for file in files {
            let path = root.join(file);
            fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
            let content = if *file == ".gitignore" {
                "node_modules/\n*.log\ndist/\n"
            } else {
                ""
            };
            fs::write(path, content).expect("write");
        }
        let matcher = IgnoreMatcher::new(&root);
        Fixture {
            _dir: dir,
            root,
            matcher,
        }
    }

    fn names(listing: &DirListing) -> Vec<&str> {
        listing.entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn lists_directories_before_files_sorted_case_insensitively() {
        let fx = fixture(&["b.ts", "A.ts", "src/main.ts", "docs/readme.md", "Zed/z.ts"]);
        let listing = list_dir(&fx.root, &fx.matcher).expect("list");
        assert_eq!(names(&listing), ["docs", "src", "Zed", "A.ts", "b.ts"]);
        assert!(!listing.truncated);
    }

    #[test]
    fn hides_gitignored_entries_and_the_git_directory() {
        let fx = fixture(&[
            ".gitignore",
            "node_modules/react/index.js",
            "dist/out.js",
            "debug.log",
            "src/main.ts",
        ]);
        let listing = list_dir(&fx.root, &fx.matcher).expect("list");
        assert_eq!(names(&listing), ["src", ".gitignore"]);
    }

    #[test]
    fn shows_dotfiles_that_are_not_ignored() {
        let fx = fixture(&[".env.example", ".gitignore"]);
        let listing = list_dir(&fx.root, &fx.matcher).expect("list");
        assert_eq!(names(&listing), [".env.example", ".gitignore"]);
    }

    #[test]
    fn lists_a_subdirectory_with_wire_paths() {
        let fx = fixture(&["src/a.ts", "src/lib/b.ts"]);
        let listing = list_dir(&fx.root.join("src"), &fx.matcher).expect("list");
        assert_eq!(names(&listing), ["lib", "a.ts"]);
        let expected = to_wire(&fx.root.join("src").join("a.ts"));
        assert_eq!(listing.entries[1].path, expected);
        assert_eq!(listing.entries[1].kind, EntryKind::File);
    }

    #[test]
    fn rejects_files_and_missing_directories() {
        let fx = fixture(&["a.ts"]);
        let not_dir = list_dir(&fx.root.join("a.ts"), &fx.matcher).expect_err("file");
        assert_eq!(not_dir.code(), "not_a_directory");
        let missing = list_dir(&fx.root.join("nope"), &fx.matcher).expect_err("missing");
        assert_eq!(missing.code(), "not_found");
    }

    #[test]
    fn truncates_huge_directories() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        for index in 0..MAX_DIR_ENTRIES + 3 {
            fs::write(root.join(format!("f{index:05}.txt")), "").expect("write");
        }
        let matcher = IgnoreMatcher::new(&root);
        let listing = list_dir(&root, &matcher).expect("list");
        assert_eq!(listing.entries.len(), MAX_DIR_ENTRIES);
        assert!(listing.truncated);
    }
}
