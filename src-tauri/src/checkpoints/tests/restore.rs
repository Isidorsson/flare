use super::support::{conflicts_of, paths_of, Fixture};
use crate::checkpoints::model::{FileAction, RestoreRequest, RestoreResult};

fn undo(turn: u32) -> RestoreRequest {
    RestoreRequest::UndoTurn { turn }
}

fn restore_before(turn: u32) -> RestoreRequest {
    RestoreRequest::RestoreBefore { turn }
}

#[test]
fn undo_puts_back_modified_created_and_deleted_files() {
    let fixture = Fixture::repo();
    fixture.write("keep.txt", "edited by the user before the turn\n");

    let turn = fixture.turn(|f| {
        f.write("a.txt", "a changed by the agent\n");
        f.remove("b.txt");
        f.write("new/deep/created.txt", "created by the agent\n");
    });
    let result = fixture.restore(undo(turn), false);

    let RestoreResult::Restored { files, .. } = result else {
        panic!("expected a restore, got {result:?}");
    };
    assert_eq!(fixture.read("a.txt"), "a1\n");
    assert_eq!(fixture.read("b.txt"), "b1\n");
    assert!(!fixture.exists("new/deep/created.txt"));
    assert!(
        !fixture.exists("new"),
        "folders the turn created are removed with it"
    );
    assert_eq!(
        fixture.read("keep.txt"),
        "edited by the user before the turn\n",
        "a file the turn did not touch keeps its content"
    );
    assert_eq!(paths_of(&files), ["a.txt", "b.txt", "new/deep/created.txt"]);
    let action = |path: &str| files.iter().find(|f| f.path == path).map(|f| f.action);
    assert_eq!(action("a.txt"), Some(FileAction::Revert));
    assert_eq!(action("b.txt"), Some(FileAction::Recreate));
    assert_eq!(action("new/deep/created.txt"), Some(FileAction::Delete));
}

#[test]
fn undo_never_touches_files_the_turn_did_not_change() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|f| f.write("a.txt", "agent\n"));
    fixture.write("keep.txt", "the user kept typing\n");
    fixture.write("untouched-by-turn.txt", "brand new user file\n");
    fixture.remove("b.txt");

    fixture.restored(undo(turn), false);

    assert_eq!(fixture.read("a.txt"), "a1\n");
    assert_eq!(fixture.read("keep.txt"), "the user kept typing\n");
    assert_eq!(
        fixture.read("untouched-by-turn.txt"),
        "brand new user file\n"
    );
    assert!(
        !fixture.exists("b.txt"),
        "a deletion the turn did not make stays"
    );
}

#[test]
fn binary_content_and_the_executable_bit_come_back_exactly() {
    let fixture = Fixture::repo();
    let original: Vec<u8> = (0..=255).chain([0, 0, 13, 10, 13]).collect();
    fixture.write_bytes("image.bin", &original);
    fixture.write("run.sh", "#!/bin/sh\necho hi\n");
    fixture.git(&["add", "-A"]);
    fixture.git(&["update-index", "--chmod=+x", "run.sh"]);
    fixture.git(&["commit", "--quiet", "-m", "binary and script"]);

    let turn = fixture.turn(|f| {
        f.write_bytes("image.bin", b"not the image anymore");
        f.remove("run.sh");
    });
    fixture.restored(undo(turn), false);

    assert_eq!(fixture.read_bytes("image.bin"), original);
    assert_eq!(fixture.read("run.sh"), "#!/bin/sh\necho hi\n");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(fixture.path("run.sh"))
            .expect("meta")
            .permissions()
            .mode();
        assert_eq!(mode & 0o111, 0o111, "still executable");
    }
}

#[test]
fn a_file_the_turn_deleted_and_recreated_with_other_content_is_reverted() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|f| {
        f.remove("a.txt");
        f.write("a.txt", "rewritten from scratch\n");
    });

    fixture.restored(undo(turn), false);

    assert_eq!(fixture.read("a.txt"), "a1\n");
}

#[test]
fn a_turn_that_changed_nothing_has_nothing_to_undo() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|_| {});

    assert_eq!(fixture.restore(undo(turn), false), RestoreResult::Unchanged);
    assert!(fixture.plan(undo(turn)).files.is_empty());
    assert!(
        fixture
            .flare_refs()
            .iter()
            .all(|name| !name.contains("restore-")),
        "no safety checkpoint is made for a restore that does nothing"
    );
}

#[test]
fn undoing_the_same_turn_twice_the_second_time_does_nothing() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|f| f.write("a.txt", "agent\n"));

    fixture.restored(undo(turn), false);

    assert_eq!(fixture.restore(undo(turn), false), RestoreResult::Unchanged);
}

#[test]
fn restore_before_a_turn_rolls_back_that_turn_and_all_later_ones() {
    let fixture = Fixture::repo();
    let first = fixture.turn(|f| f.write("a.txt", "a after turn 1\n"));
    let second = fixture.turn(|f| {
        f.write("a.txt", "a after turn 2\n");
        f.write("second.txt", "made in turn 2\n");
    });
    let third = fixture.turn(|f| {
        f.remove("b.txt");
        f.write("third.txt", "made in turn 3\n");
    });
    assert_eq!((first, second, third), (1, 2, 3));

    fixture.restored(restore_before(second), false);

    assert_eq!(fixture.read("a.txt"), "a after turn 1\n", "turn 1 is kept");
    assert_eq!(fixture.read("b.txt"), "b1\n");
    assert!(!fixture.exists("second.txt"));
    assert!(!fixture.exists("third.txt"));
}

#[test]
fn restore_before_the_first_turn_returns_to_the_original_workspace() {
    let fixture = Fixture::repo();
    fixture.turn(|f| f.write("a.txt", "one\n"));
    fixture.turn(|f| f.write("c.txt", "two\n"));

    fixture.restored(restore_before(1), false);

    assert_eq!(fixture.read("a.txt"), "a1\n");
    assert!(!fixture.exists("c.txt"));
}

#[test]
fn the_plan_lists_what_would_change_and_changes_nothing() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|f| {
        f.write("a.txt", "agent\n");
        f.write("c.txt", "agent\n");
    });
    let refs_before = fixture.flare_refs();

    let plan = fixture.plan(undo(turn));

    assert_eq!(paths_of(&plan.files), ["a.txt", "c.txt"]);
    assert!(conflicts_of(&plan.files).is_empty());
    assert_eq!(fixture.read("a.txt"), "agent\n");
    assert!(fixture.exists("c.txt"));
    assert_eq!(
        fixture.flare_refs(),
        refs_before,
        "planning leaves no refs behind"
    );
}

#[test]
fn restoring_a_turn_that_never_finished_or_never_existed_is_a_clear_error() {
    let fixture = Fixture::repo();
    let open_turn = fixture.start().turn;

    let unfinished = fixture
        .try_restore(undo(open_turn), false)
        .expect_err("unfinished");
    assert_eq!(unfinished.code(), "no_checkpoint");
    assert!(unfinished.to_string().contains("no snapshot from after"));
    let unknown = fixture
        .try_restore(restore_before(99), false)
        .expect_err("unknown");
    assert_eq!(unknown.code(), "no_checkpoint");
    let redo = fixture
        .try_restore(RestoreRequest::Redo { restore: 5 }, false)
        .expect_err("no such restore");
    assert_eq!(redo.code(), "no_checkpoint");
}

#[test]
fn a_restore_leaves_the_users_index_head_and_branches_alone() {
    let fixture = Fixture::repo();
    fixture.write("b.txt", "staged\n");
    fixture.git(&["add", "b.txt"]);
    let head = fixture.git(&["rev-parse", "HEAD"]);
    let staged = fixture.git(&["ls-files", "--stage"]);
    let branches = fixture.git(&["branch", "--list"]);
    let turn = fixture.turn(|f| f.write("a.txt", "agent\n"));

    fixture.restored(undo(turn), false);

    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(fixture.git(&["ls-files", "--stage"]), staged);
    assert_eq!(fixture.git(&["branch", "--list"]), branches);
}

#[test]
fn files_with_unusual_names_are_restored() {
    let fixture = Fixture::repo();
    fixture.write("dir with spaces/file [1] (copy).txt", "original\n");
    fixture.write("ünïcode/naïve.txt", "original\n");
    fixture.git(&["add", "-A"]);
    fixture.git(&["commit", "--quiet", "-m", "names"]);

    let turn = fixture.turn(|f| {
        f.write("dir with spaces/file [1] (copy).txt", "changed\n");
        f.remove("ünïcode/naïve.txt");
        f.write("glob[ab].txt", "made\n");
    });
    fixture.restored(undo(turn), false);

    assert_eq!(
        fixture.read("dir with spaces/file [1] (copy).txt"),
        "original\n"
    );
    assert_eq!(fixture.read("ünïcode/naïve.txt"), "original\n");
    assert!(!fixture.exists("glob[ab].txt"));
}

#[test]
fn ignored_files_are_neither_snapshotted_nor_restored() {
    let fixture = Fixture::repo();
    fixture.write(".gitignore", "*.log\nbuild/\n");
    fixture.git(&["add", "-A"]);
    fixture.git(&["commit", "--quiet", "-m", "ignore"]);
    fixture.write("debug.log", "before\n");

    let turn = fixture.turn(|f| {
        f.write("debug.log", "agent output\n");
        f.write("build/out.bin", "artifact\n");
        f.write("a.txt", "agent\n");
    });
    fixture.restored(undo(turn), false);

    assert_eq!(fixture.read("a.txt"), "a1\n");
    assert_eq!(fixture.read("debug.log"), "agent output\n");
    assert!(fixture.exists("build/out.bin"));
}

#[test]
fn in_a_repository_files_round_trip_through_the_users_line_ending_settings() {
    let fixture = Fixture::repo();
    fixture.git(&["config", "core.autocrlf", "true"]);
    fixture.write_bytes("windows.txt", b"one\r\ntwo\r\n");
    fixture.git(&["add", "-A"]);
    fixture.git(&["commit", "--quiet", "-m", "crlf file"]);

    let turn = fixture.turn(|f| f.write_bytes("windows.txt", b"changed\r\n"));
    fixture.restored(undo(turn), false);

    assert_eq!(fixture.read_bytes("windows.txt"), b"one\r\ntwo\r\n");
}
