use super::support::{paths_of, Fixture};
use crate::checkpoints::model::{FileStatus, RestoreRequest};

fn package_workspace() -> Fixture {
    let fixture = Fixture::repo();
    fixture.write("pkg/inner.txt", "inner1\n");
    fixture.write("pkg/deep/more.txt", "more1\n");
    fixture.git(&["add", "-A"]);
    fixture.git(&["commit", "--quiet", "-m", "package"]);
    fixture.in_subfolder("pkg")
}

#[test]
fn a_workspace_below_the_repository_root_restores_only_its_own_folder() {
    let fixture = package_workspace();

    let turn = fixture.turn(|f| {
        f.write("inner.txt", "inner by the agent\n");
        f.write("created.txt", "created\n");
        f.write_top("top.txt", "changed outside the workspace\n");
    });
    fixture.restored(RestoreRequest::UndoTurn { turn }, false);

    assert_eq!(fixture.read("inner.txt"), "inner1\n");
    assert!(!fixture.exists("created.txt"));
    assert_eq!(
        fixture.read_top("top.txt"),
        "changed outside the workspace\n",
        "files outside the workspace folder are never restored"
    );
}

#[test]
fn paths_in_diffs_and_plans_are_relative_to_the_workspace_folder() {
    let fixture = package_workspace();

    let turn = fixture.turn(|f| {
        f.write("deep/more.txt", "more2\n");
        f.write_top("top.txt", "outside\n");
    });

    let diff = fixture.diff(turn);
    assert_eq!(paths_of_deltas(&diff.files), ["deep/more.txt"]);
    assert_eq!(diff.files[0].status, FileStatus::Modified);
    let plan = fixture.plan(RestoreRequest::UndoTurn { turn });
    assert_eq!(paths_of(&plan.files), ["deep/more.txt"]);
}

#[test]
fn changes_made_outside_the_workspace_between_snapshots_are_not_attributed_to_the_turn() {
    let fixture = package_workspace();

    let turn = fixture.turn(|f| {
        f.write_top("top.txt", "staged outside\n");
        f.git(&["add", "../top.txt"]);
        f.write("inner.txt", "agent\n");
    });

    assert_eq!(paths_of_deltas(&fixture.diff(turn).files), ["inner.txt"]);
}

#[test]
fn the_workspace_may_be_any_folder_inside_the_repository_not_only_its_root() {
    let fixture = package_workspace();
    let turn = fixture.turn(|f| f.remove("deep/more.txt"));

    fixture.restored(RestoreRequest::RestoreBefore { turn }, false);

    assert_eq!(fixture.read("deep/more.txt"), "more1\n");
}

fn paths_of_deltas(files: &[crate::checkpoints::model::FileDelta]) -> Vec<String> {
    let mut paths: Vec<String> = files.iter().map(|file| file.path.clone()).collect();
    paths.sort();
    paths
}

#[test]
fn a_linked_worktree_is_snapshotted_through_its_own_index_and_leaves_both_indexes_alone() {
    let fixture = Fixture::repo();
    let elsewhere = tempfile::tempdir().expect("tempdir");
    let checkout = elsewhere.path().join("linked");
    fixture.git(&[
        "worktree",
        "add",
        "--quiet",
        "-b",
        "feature",
        checkout.to_str().expect("utf8"),
    ]);
    let main_index = std::fs::read(fixture.top.join(".git/index")).expect("main index");
    let linked_index =
        std::fs::read(fixture.top.join(".git/worktrees/linked/index")).expect("linked index");
    let fixture = fixture.at(checkout);

    let turn = fixture.turn(|f| {
        f.write(
            "a.txt",
            "changed in the linked worktree
",
        );
        f.write(
            "new.txt", "created
",
        );
    });
    fixture.restored(RestoreRequest::UndoTurn { turn }, false);

    assert_eq!(
        fixture.read("a.txt"),
        "a1
"
    );
    assert!(!fixture.exists("new.txt"));
    assert_eq!(
        std::fs::read(fixture.top.join(".git/index")).expect("main index"),
        main_index
    );
    assert_eq!(
        std::fs::read(fixture.top.join(".git/worktrees/linked/index")).expect("linked index"),
        linked_index
    );
}
