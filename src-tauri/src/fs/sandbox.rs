use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

use super::error::FsError;

pub const GIT_DIR: &str = ".git";

#[derive(Debug)]
pub struct Sandbox {
    root: PathBuf,
}

impl Sandbox {
    pub fn open(root: &str) -> Result<Self, FsError> {
        let canonical = dunce::canonicalize(root).map_err(|e| FsError::io(Path::new(root), e))?;
        if !canonical.is_dir() {
            return Err(FsError::NotADirectory(canonical.display().to_string()));
        }
        Ok(Self { root: canonical })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn resolve(&self, input: &str) -> Result<PathBuf, FsError> {
        let candidate = Path::new(input);
        let joined = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            self.root.join(candidate)
        };
        let resolved = canonicalize_lenient(&lexically_normalized(&joined))?;
        if resolved.starts_with(&self.root) {
            Ok(resolved)
        } else {
            Err(FsError::OutsideWorkspace(input.to_owned()))
        }
    }

    pub fn resolve_writable(&self, input: &str) -> Result<PathBuf, FsError> {
        let resolved = self.resolve(input)?;
        if self.is_inside_git_dir(&resolved) {
            return Err(FsError::ProtectedPath(input.to_owned()));
        }
        Ok(resolved)
    }

    fn is_inside_git_dir(&self, path: &Path) -> bool {
        path.strip_prefix(&self.root)
            .is_ok_and(|rel| rel.components().any(|c| c.as_os_str() == GIT_DIR))
    }
}

pub fn to_wire(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn lexically_normalized(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Canonicalizes the deepest existing ancestor so symlinks cannot smuggle a
/// path out of the workspace, then re-appends the not-yet-existing tail.
fn canonicalize_lenient(path: &Path) -> Result<PathBuf, FsError> {
    let mut existing = path.to_path_buf();
    let mut tail: Vec<OsString> = Vec::new();
    loop {
        match existing.symlink_metadata() {
            Ok(_) => break,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let Some(name) = existing.file_name().map(OsString::from) else {
                    return Err(FsError::NotFound(path.display().to_string()));
                };
                tail.push(name);
                existing.pop();
            }
            Err(e) => return Err(FsError::io(&existing, e)),
        }
    }
    let mut resolved = dunce::canonicalize(&existing).map_err(|e| FsError::io(&existing, e))?;
    resolved.extend(tail.iter().rev());
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn workspace() -> (tempfile::TempDir, Sandbox) {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("src")).expect("mkdir");
        fs::write(dir.path().join("src/a.ts"), "x").expect("write");
        let sandbox = Sandbox::open(dir.path().to_str().expect("utf8")).expect("open");
        (dir, sandbox)
    }

    #[test]
    fn open_rejects_a_file_and_a_missing_path() {
        let (dir, _sandbox) = workspace();
        let file = dir.path().join("src/a.ts");
        let not_dir = Sandbox::open(file.to_str().expect("utf8")).expect_err("file root");
        assert_eq!(not_dir.code(), "not_a_directory");
        let missing = dir.path().join("nope");
        let not_found = Sandbox::open(missing.to_str().expect("utf8")).expect_err("missing root");
        assert_eq!(not_found.code(), "not_found");
    }

    #[test]
    fn resolves_relative_and_absolute_paths_inside_the_root() {
        let (_dir, sandbox) = workspace();
        let relative = sandbox.resolve("src/a.ts").expect("relative");
        assert_eq!(relative, sandbox.root().join("src").join("a.ts"));
        let absolute = sandbox
            .resolve(relative.to_str().expect("utf8"))
            .expect("absolute");
        assert_eq!(absolute, relative);
    }

    #[test]
    fn resolves_paths_that_do_not_exist_yet() {
        let (_dir, sandbox) = workspace();
        let created = sandbox.resolve("src/new/deep.ts").expect("new path");
        assert_eq!(created, sandbox.root().join("src/new/deep.ts"));
    }

    #[test]
    fn normalizes_dot_segments_that_stay_inside() {
        let (_dir, sandbox) = workspace();
        let resolved = sandbox.resolve("src/../src/./a.ts").expect("dots");
        assert_eq!(resolved, sandbox.root().join("src").join("a.ts"));
    }

    #[test]
    fn rejects_parent_escapes() {
        let (_dir, sandbox) = workspace();
        for attempt in [
            "../outside.txt",
            "src/../../outside.txt",
            "../../../../etc/passwd",
        ] {
            let error = sandbox.resolve(attempt).expect_err(attempt);
            assert_eq!(error.code(), "outside_workspace", "{attempt}");
        }
    }

    #[test]
    fn rejects_absolute_paths_elsewhere() {
        let (_dir, sandbox) = workspace();
        let other = tempfile::tempdir().expect("other dir");
        let target = other.path().join("file.txt");
        let error = sandbox
            .resolve(target.to_str().expect("utf8"))
            .expect_err("elsewhere");
        assert_eq!(error.code(), "outside_workspace");
    }

    #[test]
    fn rejects_sibling_directories_sharing_a_name_prefix() {
        let (dir, sandbox) = workspace();
        let sibling = PathBuf::from(format!("{}-evil", dir.path().display()));
        fs::create_dir_all(&sibling).expect("sibling");
        let error = sandbox
            .resolve(sibling.join("x").to_str().expect("utf8"))
            .expect_err("sibling");
        fs::remove_dir_all(&sibling).expect("cleanup");
        assert_eq!(error.code(), "outside_workspace");
    }

    #[test]
    fn writable_resolution_protects_the_git_dir() {
        let (_dir, sandbox) = workspace();
        let error = sandbox
            .resolve_writable(".git/config")
            .expect_err("git config");
        assert_eq!(error.code(), "protected_path");
        sandbox
            .resolve_writable(".gitignore")
            .expect("gitignore is fine");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_point_outside() {
        let (_dir, sandbox) = workspace();
        let other = tempfile::tempdir().expect("other dir");
        std::os::unix::fs::symlink(other.path(), sandbox.root().join("escape")).expect("symlink");
        let error = sandbox.resolve("escape/file.txt").expect_err("symlink");
        assert_eq!(error.code(), "outside_workspace");
    }

    #[test]
    fn wire_paths_use_forward_slashes() {
        assert_eq!(to_wire(Path::new("C:\\a\\b.ts")), "C:/a/b.ts");
    }
}
