use std::collections::BTreeMap;
use std::fs;

use super::support::{Fixture, SESSION, START_TIME};
use crate::checkpoints::model::{CreateRequest, Phase, StoreKind};
use crate::checkpoints::CheckpointState;

/// Everything a snapshot promises not to change in the user's repository, read through real git.
#[derive(Debug, PartialEq, Eq)]
struct RepoState {
    index_bytes: Vec<u8>,
    staged: String,
    head: String,
    branches: String,
    stash: String,
    other_refs: String,
    config: Vec<u8>,
    status: String,
    git_dir_entries: Vec<String>,
    files: BTreeMap<String, Vec<u8>>,
}

fn capture(fixture: &Fixture) -> RepoState {
    let git_dir = fixture.path(".git");
    let mut entries: Vec<String> = fs::read_dir(&git_dir)
        .expect("read .git")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    entries.sort();
    let mut files = BTreeMap::new();
    for name in ["a.txt", "b.txt", "keep.txt", "untracked.txt", "ignored.log"] {
        if fixture.exists(name) {
            files.insert(name.to_owned(), fixture.read_bytes(name));
        }
    }
    RepoState {
        index_bytes: fs::read(git_dir.join("index")).expect("index"),
        staged: fixture.git(&["ls-files", "--stage"]),
        head: fixture.git(&["rev-parse", "HEAD"]),
        branches: fixture.git(&["branch", "--list", "--all"]),
        stash: fixture.git(&["stash", "list"]),
        other_refs: fixture.git(&[
            "for-each-ref",
            "--format=%(refname) %(objectname)",
            "refs/heads/",
            "refs/tags/",
            "refs/stash",
        ]),
        config: fs::read(git_dir.join("config")).expect("config"),
        status: fixture.git(&[
            "--no-optional-locks",
            "status",
            "--porcelain=v2",
            "--untracked-files=all",
        ]),
        git_dir_entries: entries,
        files,
    }
}

fn busy_repo() -> Fixture {
    let fixture = Fixture::repo();
    fixture.write(".gitignore", "*.log\n");
    fixture.git(&["add", ".gitignore"]);
    fixture.git(&["commit", "--quiet", "-m", "ignore logs"]);
    fixture.write("a.txt", "a stashed change\n");
    fixture.git(&["stash", "push", "--quiet", "-m", "wip"]);
    fixture.write("b.txt", "b staged\n");
    fixture.git(&["add", "b.txt"]);
    fixture.write("b.txt", "b staged then edited again\n");
    fixture.write("a.txt", "a unstaged edit\n");
    fixture.write("untracked.txt", "untracked\n");
    fixture.write("ignored.log", "ignored\n");
    fixture
}

#[test]
fn a_snapshot_does_not_touch_the_index_head_branches_stash_config_or_files() {
    let fixture = busy_repo();
    fixture.git(&["status", "--short"]);
    let before = capture(&fixture);

    fixture.start();
    fixture.end(1);

    assert_eq!(capture(&fixture), before);
}

#[test]
fn a_snapshot_adds_only_refs_under_the_hidden_namespace() {
    let fixture = busy_repo();
    let all_before = fixture.git(&["for-each-ref", "--format=%(refname)"]);

    fixture.start();

    let all_after = fixture.git(&["for-each-ref", "--format=%(refname)"]);
    let added: Vec<&str> = all_after
        .lines()
        .filter(|line| !all_before.lines().any(|before| before == *line))
        .collect();
    assert_eq!(added, [format!("refs/flare/checkpoints/{SESSION}/1/start")]);
    assert!(!fixture.path(".git/index.lock").exists());
}

#[test]
fn the_snapshot_holds_the_working_tree_not_the_staged_state() {
    let fixture = busy_repo();

    let snapshot = fixture.start();

    let committed = |path: &str| fixture.git(&["show", &format!("{}:{path}", snapshot.commit)]);
    assert_eq!(committed("b.txt"), "b staged then edited again");
    assert_eq!(committed("a.txt"), "a unstaged edit");
    assert_eq!(committed("keep.txt"), "keep");
}

#[test]
fn untracked_files_are_snapshotted_and_ignored_files_are_not() {
    let fixture = busy_repo();
    fixture.write("sub/nested-untracked.txt", "n\n");
    fixture.write("sub/nested.log", "ignored nested\n");

    let snapshot = fixture.start();

    let tree = fixture.git(&["ls-tree", "-r", "--name-only", &snapshot.commit]);
    let names: Vec<&str> = tree.lines().collect();
    assert!(names.contains(&"untracked.txt"), "{names:?}");
    assert!(names.contains(&"sub/nested-untracked.txt"), "{names:?}");
    assert!(!names.contains(&"ignored.log"), "{names:?}");
    assert!(!names.contains(&"sub/nested.log"), "{names:?}");
}

#[test]
fn a_snapshot_commit_is_a_parentless_commit_by_flare() {
    let fixture = Fixture::repo();

    let snapshot = fixture.start();

    let parents = fixture.git(&["rev-list", "--parents", "-n", "1", &snapshot.commit]);
    assert_eq!(parents, snapshot.commit, "no parents");
    let author = fixture.git(&["log", "-1", "--format=%an <%ae> %at", &snapshot.commit]);
    assert_eq!(author, format!("Flare <flare@localhost> {START_TIME}"));
    assert_eq!(snapshot.created_at, START_TIME);
    assert_eq!(snapshot.store, StoreKind::Git);
}

#[test]
fn snapshots_work_when_commit_signing_is_required_and_no_identity_is_configured() {
    let fixture = Fixture::repo();
    fixture.git(&["config", "commit.gpgsign", "true"]);
    fixture.git(&["config", "gpg.program", "flare-no-such-signer"]);
    fixture.git(&["config", "--unset", "user.name"]);
    fixture.git(&["config", "--unset", "user.email"]);

    let snapshot = fixture.start();

    assert!(!snapshot.commit.is_empty());
}

#[test]
fn a_repository_with_no_commits_and_no_index_can_be_snapshotted() {
    let fixture = Fixture::repo();
    let empty = tempfile::tempdir().expect("tempdir");
    super::support::run_git(empty.path(), &["init", "--quiet"]);
    fs::write(empty.path().join("new.txt"), "n\n").expect("write");

    let state = CheckpointState::new(&fixture.data);
    let snapshot = state
        .create(CreateRequest {
            root: empty.path().to_string_lossy().into_owned(),
            session_id: SESSION.to_owned(),
            phase: Phase::Start,
            turn: None,
        })
        .expect("snapshot");

    let root = dunce::canonicalize(empty.path()).expect("canonical");
    let tree = super::support::run_git(&root, &["ls-tree", "-r", "--name-only", &snapshot.commit]);
    assert_eq!(tree, "new.txt");
}

#[test]
fn turn_numbers_count_up_within_a_session_and_sessions_are_independent() {
    let fixture = Fixture::repo();

    let first = fixture.start_session("alpha");
    let second = fixture.start_session("alpha");
    let other = fixture.start_session("beta");

    assert_eq!((first.turn, second.turn, other.turn), (1, 2, 1));
}

#[test]
fn an_end_snapshot_needs_an_open_turn_and_cannot_be_recorded_twice() {
    let fixture = Fixture::repo();

    let no_turn = fixture
        .try_create(SESSION, Phase::End, None)
        .expect_err("end without a turn");
    assert_eq!(no_turn.code(), "invalid_request");
    let unknown = fixture
        .try_create(SESSION, Phase::End, Some(7))
        .expect_err("end of a turn that never started");
    assert_eq!(unknown.code(), "no_checkpoint");

    let turn = fixture.start().turn;
    fixture.end(turn);
    let again = fixture
        .try_create(SESSION, Phase::End, Some(turn))
        .expect_err("second end");
    assert_eq!(again.code(), "invalid_request");
}

#[test]
fn unsafe_session_ids_are_refused_before_git_runs() {
    let fixture = Fixture::repo();
    for bad in ["", "../x", "a b", "refs/heads/main"] {
        let error = fixture.try_create(bad, Phase::Start, None).expect_err(bad);
        assert_eq!(error.code(), "invalid_request", "{bad:?}");
    }
    assert!(fixture.flare_refs().is_empty());
}

#[cfg(windows)]
#[test]
fn a_file_another_program_holds_open_is_reported_and_does_not_block_the_snapshot() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;

    let fixture = Fixture::repo();
    fixture.write("locked.db", "database\n");
    let _held = OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(fixture.path("locked.db"))
        .expect("hold the file");

    let snapshot = fixture.start();

    assert!(
        !snapshot.warnings.is_empty(),
        "the skipped file is reported"
    );
    let tree = fixture.git(&["ls-tree", "-r", "--name-only", &snapshot.commit]);
    assert!(
        tree.lines().any(|name| name == "a.txt"),
        "other files are still captured"
    );
}
