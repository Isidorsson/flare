use std::fs;
use std::path::PathBuf;

use super::support::{paths_of, run_git, Fixture, SESSION};
use crate::checkpoints::model::{RestoreRequest, StoreKind};
use crate::checkpoints::workspace::Workspace;

fn private_repos(fixture: &Fixture) -> Vec<PathBuf> {
    let dir = fixture.data.join("checkpoints").join("repos");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut repos: Vec<PathBuf> = entries.map(|entry| entry.expect("entry").path()).collect();
    repos.sort();
    repos
}

#[test]
fn a_folder_outside_any_repository_gets_a_private_one_and_is_not_modified() {
    let fixture = Fixture::plain();

    let snapshot = fixture.start();

    assert_eq!(snapshot.store, StoreKind::Private);
    assert!(
        !fixture.exists(".git"),
        "no .git is added to the user's folder"
    );
    let repos = private_repos(&fixture);
    assert_eq!(repos.len(), 1);
    assert!(repos[0].join("HEAD").is_file());
    let tree = run_git(
        &repos[0],
        &[
            "--git-dir",
            ".",
            "ls-tree",
            "-r",
            "--name-only",
            &snapshot.commit,
        ],
    );
    assert_eq!(
        tree.lines().collect::<Vec<_>>(),
        ["a.txt", "b.txt", "keep.txt"]
    );
    let listed = fs::read_dir(&fixture.root).expect("list folder").count();
    assert_eq!(listed, 3, "the folder still holds only its own files");
}

#[test]
fn undo_works_in_a_private_repository() {
    let fixture = Fixture::plain();

    let turn = fixture.turn(|f| {
        f.write("a.txt", "agent\n");
        f.remove("b.txt");
        f.write("src/new.txt", "created\n");
    });
    let plan = fixture.plan(RestoreRequest::UndoTurn { turn });
    assert_eq!(paths_of(&plan.files), ["a.txt", "b.txt", "src/new.txt"]);
    fixture.restored(RestoreRequest::UndoTurn { turn }, false);

    assert_eq!(fixture.read("a.txt"), "a1\n");
    assert_eq!(fixture.read("b.txt"), "b1\n");
    assert!(!fixture.exists("src"));
    assert_eq!(fixture.read("keep.txt"), "keep\n");
}

#[test]
fn redo_and_conflicts_work_in_a_private_repository_too() {
    let fixture = Fixture::plain();
    let turn = fixture.turn(|f| f.write("a.txt", "agent\n"));
    fixture.write("a.txt", "user edit\n");

    let plan = fixture.plan(RestoreRequest::UndoTurn { turn });
    assert!(plan.files[0].conflict);
    let id = fixture.restored(RestoreRequest::UndoTurn { turn }, true);
    assert_eq!(fixture.read("a.txt"), "a1\n");

    fixture.restored(RestoreRequest::Redo { restore: id }, false);
    assert_eq!(
        fixture.read("a.txt"),
        "user edit\n",
        "redo returns to the state before the undo, the discarded edit included"
    );
}

#[test]
fn private_repositories_restore_the_exact_bytes_whatever_the_line_ending_settings() {
    let fixture = Fixture::plain();
    fixture.write(".gitattributes", "* text eol=crlf\n");
    fixture.write_bytes("lf.txt", b"one\ntwo\n");
    fixture.write_bytes("crlf.txt", b"one\r\ntwo\r\n");
    fixture.write_bytes("mixed.txt", b"one\r\ntwo\nthree\r");

    let turn = fixture.turn(|f| {
        f.write_bytes("lf.txt", b"changed");
        f.write_bytes("crlf.txt", b"changed");
        f.write_bytes("mixed.txt", b"changed");
    });
    fixture.restored(RestoreRequest::UndoTurn { turn }, false);

    assert_eq!(fixture.read_bytes("lf.txt"), b"one\ntwo\n");
    assert_eq!(fixture.read_bytes("crlf.txt"), b"one\r\ntwo\r\n");
    assert_eq!(fixture.read_bytes("mixed.txt"), b"one\r\ntwo\nthree\r");
}

#[test]
fn gitignore_files_are_honoured_even_without_a_repository() {
    let fixture = Fixture::plain();
    fixture.write(".gitignore", "*.log\nout/\n");
    fixture.write("noise.log", "x\n");
    fixture.write("out/artifact.bin", "x\n");

    let snapshot = fixture.start();

    let repos = private_repos(&fixture);
    let tree = run_git(
        &repos[0],
        &[
            "--git-dir",
            ".",
            "ls-tree",
            "-r",
            "--name-only",
            &snapshot.commit,
        ],
    );
    let names: Vec<&str> = tree.lines().collect();
    assert!(names.contains(&".gitignore"));
    assert!(!names.contains(&"noise.log"), "{names:?}");
    assert!(!names.contains(&"out/artifact.bin"), "{names:?}");
}

#[test]
fn each_folder_gets_its_own_private_repository_and_reuses_it() {
    let first = Fixture::plain();
    first.start();
    first.start();
    assert_eq!(
        private_repos(&first).len(),
        1,
        "the same folder reuses its repository"
    );

    let second_folder = tempfile::tempdir().expect("second folder");
    fs::write(second_folder.path().join("x.txt"), "x\n").expect("write");
    let resolved = Workspace::resolve(
        second_folder.path().to_str().expect("utf8"),
        &first.data.join("checkpoints").join("repos"),
    )
    .expect("resolve");

    assert_eq!(resolved.kind(), StoreKind::Private);
    assert_eq!(private_repos(&first).len(), 2);
}

#[test]
fn a_huge_folder_without_git_is_refused_and_nothing_is_created() {
    let fixture = Fixture::plain();
    for n in 0..6 {
        fixture.write(&format!("bulk/file-{n}.txt"), "x\n");
    }
    let repos = fixture.data.join("checkpoints").join("repos");

    let error =
        Workspace::resolve_limited(&fixture.root_str(), &repos, 5).expect_err("too many files");

    assert_eq!(error.code(), "too_large");
    assert!(error.to_string().contains("git init"));
    assert!(!repos.exists());
}

#[test]
fn ignored_files_do_not_count_towards_the_size_limit() {
    let fixture = Fixture::plain();
    fixture.write(".gitignore", "node_modules/\n");
    for n in 0..30 {
        fixture.write(&format!("node_modules/pkg/file-{n}.js"), "x\n");
    }
    let repos = fixture.data.join("checkpoints").join("repos");

    let resolved =
        Workspace::resolve_limited(&fixture.root_str(), &repos, 10).expect("small enough");

    assert_eq!(resolved.kind(), StoreKind::Private);
}

#[test]
fn the_startup_sweep_removes_expired_private_repositories_and_keeps_live_ones() {
    let fixture = Fixture::plain();
    fixture.start();
    let day = 24 * 60 * 60;
    fixture.advance(15 * day);

    let other = tempfile::tempdir().expect("other folder");
    fs::write(other.path().join("x.txt"), "x\n").expect("write");
    let state = fixture.state.clone();
    state
        .create(crate::checkpoints::model::CreateRequest {
            root: other.path().to_string_lossy().into_owned(),
            session_id: SESSION.to_owned(),
            phase: crate::checkpoints::model::Phase::Start,
            turn: None,
        })
        .expect("snapshot in the other folder");
    assert_eq!(private_repos(&fixture).len(), 2);

    let report = state.sweep_private_repos().expect("sweep");

    assert_eq!(report.removed_refs, 1);
    let left = private_repos(&fixture);
    assert_eq!(left.len(), 1, "the repository with nothing left is deleted");
    assert!(left[0].join("HEAD").is_file());
}

#[test]
fn sweeping_with_no_private_repositories_is_a_no_op() {
    let fixture = Fixture::repo();
    assert_eq!(
        fixture
            .state
            .sweep_private_repos()
            .expect("sweep")
            .removed_refs,
        0
    );
}
