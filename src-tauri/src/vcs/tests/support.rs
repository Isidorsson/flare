//! A throwaway repository (or plain folder) driven through the real `VcsState` and checked with
//! the real `git`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;

use crate::git_cli::Git;
use crate::vcs::error::VcsError;
use crate::vcs::model::{
    BranchRequest, CommitRequest, CommitResult, DeleteBranchRequest, FileDiff, FileDiffRequest,
    MessageContext, PathsRequest, PrContext, PrContextRequest, PrCreateRequest, PrCreated, PrInfo,
    RootRequest, VcsBranch, VcsFile, VcsStatus,
};
use crate::vcs::pr_info;
use crate::vcs::repo::Repo;
use crate::vcs::VcsState;

/// Local settings that make test repositories independent of the machine's git configuration.
const REPO_CONFIG: &str = "[user]\n\tname = Test\n\temail = test@example.com\n[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n";
pub const BRANCH: &str = "main";

pub struct Fixture {
    _dir: TempDir,
    _remote: Option<TempDir>,
    /// The folder the user would have opened, canonical.
    pub root: PathBuf,
    /// The bare repository `origin` points at, for fixtures made with `with_remote`.
    pub remote: Option<PathBuf>,
    pub state: VcsState,
}

impl Fixture {
    /// A repository on `main` with one commit holding `a.txt`, `b.txt` and `keep.txt`.
    pub fn repo() -> Self {
        let fixture = Self::unborn();
        fixture.write("a.txt", "a1\n");
        fixture.write("b.txt", "b1\n");
        fixture.write("keep.txt", "keep\n");
        fixture.git(&["add", "-A"]);
        fixture.git(&["commit", "--quiet", "-m", "initial"]);
        fixture
    }

    /// A repository with no commit yet.
    pub fn unborn() -> Self {
        let fixture = Self::folder();
        fixture.git(&["init", "--quiet", "-b", BRANCH]);
        configure(&fixture.root);
        fixture
    }

    /// A plain folder, not inside any repository.
    pub fn plain() -> Self {
        let fixture = Self::folder();
        fixture.write("a.txt", "a1\n");
        fixture
    }

    /// `repo()` plus a bare repository registered as `origin`, with nothing pushed yet.
    pub fn with_remote() -> Self {
        let mut fixture = Self::repo();
        let remote_dir = tempfile::tempdir().expect("remote dir");
        let remote = dunce::canonicalize(remote_dir.path()).expect("canonical remote");
        run_git(&remote, &["init", "--quiet", "--bare", "-b", BRANCH]);
        fixture.git(&["remote", "add", "origin", &remote.to_string_lossy()]);
        fixture.remote = Some(remote);
        fixture._remote = Some(remote_dir);
        fixture
    }

    /// Another working copy of this fixture's remote, as a teammate would have.
    pub fn teammate(&self) -> Self {
        let remote = self.remote.as_ref().expect("a fixture with a remote");
        let fixture = Self::folder();
        run_git(
            &fixture.root,
            &["clone", "--quiet", &remote.to_string_lossy(), "."],
        );
        configure(&fixture.root);
        fixture
    }

    fn folder() -> Self {
        let dir = tempfile::tempdir().expect("workspace dir");
        let root = dunce::canonicalize(dir.path()).expect("canonical workspace");
        Self {
            _dir: dir,
            _remote: None,
            root,
            remote: None,
            state: VcsState::default(),
        }
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    pub fn write(&self, relative: &str, content: &str) {
        self.write_bytes(relative, content.as_bytes());
    }

    pub fn write_bytes(&self, relative: &str, content: &[u8]) {
        let path = self.path(relative);
        fs::create_dir_all(path.parent().expect("parent")).expect("create parents");
        fs::write(path, content).expect("write file");
    }

    pub fn read(&self, relative: &str) -> String {
        fs::read_to_string(self.path(relative)).expect("read file")
    }

    pub fn exists(&self, relative: &str) -> bool {
        self.path(relative).exists()
    }

    pub fn remove(&self, relative: &str) {
        fs::remove_file(self.path(relative)).expect("remove file");
    }

    /// Runs real git in the workspace and returns its trimmed standard output.
    pub fn git(&self, args: &[&str]) -> String {
        run_git(&self.root, args)
    }

    /// Commits whatever is staged, straight through git.
    pub fn commit_all(&self, message: &str) {
        self.git(&["add", "-A"]);
        self.git(&["commit", "--quiet", "-m", message]);
    }

    pub fn head(&self) -> String {
        self.git(&["rev-parse", "HEAD"])
    }

    fn root_request(&self) -> RootRequest {
        RootRequest {
            root: self.root.to_string_lossy().into_owned(),
        }
    }

    fn paths_request(&self, paths: &[&str]) -> PathsRequest {
        PathsRequest {
            root: self.root.to_string_lossy().into_owned(),
            paths: paths.iter().map(|path| (*path).to_owned()).collect(),
        }
    }

    fn branch_request(&self, name: &str) -> BranchRequest {
        BranchRequest {
            root: self.root.to_string_lossy().into_owned(),
            name: name.to_owned(),
        }
    }

    pub fn status(&self) -> VcsStatus {
        self.state.status(self.root_request()).expect("status")
    }

    pub fn file_diff(&self, path: &str, staged: bool) -> Result<FileDiff, VcsError> {
        self.state.file_diff(FileDiffRequest {
            root: self.root.to_string_lossy().into_owned(),
            path: path.to_owned(),
            staged,
        })
    }

    pub fn stage(&self, paths: &[&str]) -> Result<VcsStatus, VcsError> {
        self.state.stage(self.paths_request(paths))
    }

    pub fn unstage(&self, paths: &[&str]) -> Result<VcsStatus, VcsError> {
        self.state.unstage(self.paths_request(paths))
    }

    pub fn discard(&self, paths: &[&str]) -> Result<VcsStatus, VcsError> {
        self.state.discard(self.paths_request(paths))
    }

    pub fn commit(&self, message: &str) -> Result<CommitResult, VcsError> {
        self.state.commit(CommitRequest {
            root: self.root.to_string_lossy().into_owned(),
            message: message.to_owned(),
        })
    }

    pub fn branches(&self) -> Vec<VcsBranch> {
        self.state.branches(self.root_request()).expect("branches")
    }

    pub fn create_branch(&self, name: &str) -> Result<VcsStatus, VcsError> {
        self.state.branch_create(self.branch_request(name))
    }

    pub fn switch(&self, name: &str) -> Result<VcsStatus, VcsError> {
        self.state.switch(self.branch_request(name))
    }

    pub fn delete_branch(&self, name: &str, force: bool) -> Result<VcsStatus, VcsError> {
        self.state.branch_delete(DeleteBranchRequest {
            root: self.root.to_string_lossy().into_owned(),
            name: name.to_owned(),
            force,
        })
    }

    pub fn fetch(&self) -> Result<VcsStatus, VcsError> {
        self.state.fetch(self.root_request())
    }

    pub fn pull(&self) -> Result<VcsStatus, VcsError> {
        self.state.pull(self.root_request())
    }

    pub fn push(&self) -> Result<VcsStatus, VcsError> {
        self.state.push(self.root_request())
    }

    pub fn message_context(&self) -> Result<MessageContext, VcsError> {
        self.state.message_context(self.root_request())
    }

    pub fn pr_context(&self, base: &str) -> Result<PrContext, VcsError> {
        self.state.pr_context(PrContextRequest {
            root: self.root.to_string_lossy().into_owned(),
            base: base.to_owned(),
        })
    }

    /// Asks as `vcs_pr_info` would, with `gh` replaced by the given stand-in.
    pub fn pr_info(&self, gh: &Git) -> Result<PrInfo, VcsError> {
        let repo = Repo::open(&self.root.to_string_lossy())?;
        pr_info::read(&repo, gh)
    }

    /// Creates as `vcs_pr_create` would, with `gh` replaced by the given stand-in.
    pub fn create_pr(&self, gh: &Git, request: &PrCreateRequest) -> Result<PrCreated, VcsError> {
        let repo = Repo::open(&self.root.to_string_lossy())?;
        self.state.create_pull_request(&repo, gh, request)
    }

    pub fn pr_request(&self, title: &str, base: &str) -> PrCreateRequest {
        PrCreateRequest {
            root: self.root.to_string_lossy().into_owned(),
            title: title.to_owned(),
            body: "## Summary
- the change
"
            .to_owned(),
            base: base.to_owned(),
            draft: false,
        }
    }

    /// Commits with a subject and a body paragraph, straight through git.
    pub fn commit_with_body(&self, subject: &str, body: &str) {
        self.git(&[
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            subject,
            "-m",
            body,
        ]);
    }

    /// Empty commits, one per subject, oldest first.
    pub fn commit_empty(&self, subjects: &[String]) {
        for subject in subjects {
            self.git(&["commit", "--quiet", "--allow-empty", "-m", subject]);
        }
    }
}

fn configure(root: &Path) {
    let config = root.join(".git/config");
    let mut text = fs::read_to_string(&config).expect("read config");
    text.push_str(REPO_CONFIG);
    fs::write(&config, text).expect("write config");
}

pub fn run_git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_owned()
}

/// For setting up states git refuses on purpose, such as a conflicted merge.
pub fn run_git_expecting_failure(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git runs");
    assert!(
        !output.status.success(),
        "git {args:?} was expected to fail"
    );
}

pub fn find<'a>(status: &'a VcsStatus, path: &str) -> &'a VcsFile {
    status
        .files
        .iter()
        .find(|file| file.path == path)
        .unwrap_or_else(|| panic!("{path} is not listed in {:?}", status.files))
}

pub fn paths(status: &VcsStatus) -> Vec<&str> {
    status.files.iter().map(|file| file.path.as_str()).collect()
}

pub fn error_code<T: std::fmt::Debug>(result: Result<T, VcsError>) -> &'static str {
    result.expect_err("expected an error").code()
}
