use super::support::{conflicts_of, paths_of, Fixture};
use crate::checkpoints::model::{FileAction, RestoreRequest, RestoreResult};

fn undo(turn: u32) -> RestoreRequest {
    RestoreRequest::UndoTurn { turn }
}

fn restore_before(turn: u32) -> RestoreRequest {
    RestoreRequest::RestoreBefore { turn }
}

fn changed_two_files(fixture: &Fixture) -> u32 {
    fixture.turn(|f| {
        f.write("a.txt", "a by the agent\n");
        f.write("b.txt", "b by the agent\n");
    })
}

#[test]
fn a_file_the_user_edited_after_the_turn_is_flagged_and_the_others_are_not() {
    let fixture = Fixture::repo();
    let turn = changed_two_files(&fixture);
    fixture.write("a.txt", "a by the agent, then by the user\n");

    let plan = fixture.plan(undo(turn));

    assert_eq!(paths_of(&plan.files), ["a.txt", "b.txt"]);
    assert_eq!(conflicts_of(&plan.files), ["a.txt"]);
}

#[test]
fn without_confirmation_nothing_is_touched_when_there_are_conflicts() {
    let fixture = Fixture::repo();
    let turn = changed_two_files(&fixture);
    fixture.write("a.txt", "user edit\n");
    let refs_before = fixture.flare_refs();

    let result = fixture.restore(undo(turn), false);

    let RestoreResult::Conflicts { files } = result else {
        panic!("expected conflicts, got {result:?}");
    };
    assert_eq!(conflicts_of(&files), ["a.txt"]);
    assert_eq!(fixture.read("a.txt"), "user edit\n");
    assert_eq!(
        fixture.read("b.txt"),
        "b by the agent\n",
        "even the clean file waits"
    );
    assert_eq!(
        fixture.flare_refs(),
        refs_before,
        "no safety checkpoint for a refused restore"
    );
}

#[test]
fn confirming_restores_everything_including_the_edited_file() {
    let fixture = Fixture::repo();
    let turn = changed_two_files(&fixture);
    fixture.write("a.txt", "user edit\n");

    let id = fixture.restored(undo(turn), true);

    assert_eq!(fixture.read("a.txt"), "a1\n");
    assert_eq!(fixture.read("b.txt"), "b1\n");
    assert_eq!(id, 1);
}

#[test]
fn the_edit_that_confirming_discarded_is_kept_in_the_safety_checkpoint() {
    let fixture = Fixture::repo();
    let turn = changed_two_files(&fixture);
    fixture.write("a.txt", "precious user edit\n");

    let id = fixture.restored(undo(turn), true);
    let safety = format!(
        "refs/flare/checkpoints/{}/restore-{id}/before",
        super::support::SESSION
    );

    assert_eq!(
        fixture.git(&["show", &format!("{safety}:a.txt")]),
        "precious user edit"
    );
}

#[test]
fn files_the_user_changed_that_the_turn_did_not_are_not_part_of_the_plan() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|f| f.write("a.txt", "agent\n"));
    fixture.write("keep.txt", "user edit elsewhere\n");
    fixture.write("extra.txt", "user file\n");

    let plan = fixture.plan(undo(turn));

    assert_eq!(paths_of(&plan.files), ["a.txt"]);
    assert!(conflicts_of(&plan.files).is_empty());
}

#[test]
fn a_file_the_turn_created_and_the_user_then_deleted_needs_nothing() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|f| f.write("created.txt", "agent\n"));
    fixture.remove("created.txt");

    assert!(fixture.plan(undo(turn)).files.is_empty());
    assert_eq!(fixture.restore(undo(turn), false), RestoreResult::Unchanged);
}

#[test]
fn a_file_the_user_already_put_back_needs_nothing() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|f| f.write("a.txt", "agent\n"));
    fixture.write("a.txt", "a1\n");

    assert!(fixture.plan(undo(turn)).files.is_empty());
}

#[test]
fn a_deleted_file_the_user_recreated_differently_is_a_conflict() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|f| f.remove("a.txt"));
    fixture.write("a.txt", "the user wrote a new a.txt\n");

    let plan = fixture.plan(undo(turn));

    assert_eq!(conflicts_of(&plan.files), ["a.txt"]);
    assert_eq!(plan.files[0].action, FileAction::Revert);
}

#[test]
fn a_later_turn_that_changed_the_same_file_conflicts_with_undoing_an_earlier_one() {
    let fixture = Fixture::repo();
    let first = fixture.turn(|f| {
        f.write("a.txt", "turn one\n");
        f.write("only-one.txt", "turn one\n");
    });
    fixture.turn(|f| f.write("a.txt", "turn two\n"));

    let plan = fixture.plan(undo(first));

    assert_eq!(paths_of(&plan.files), ["a.txt", "only-one.txt"]);
    assert_eq!(conflicts_of(&plan.files), ["a.txt"]);
}

#[test]
fn restore_before_flags_edits_made_between_turns_and_after_the_last_one() {
    let fixture = Fixture::repo();
    let first = fixture.turn(|f| f.write("a.txt", "turn one\n"));
    fixture.write("between.txt", "typed between the turns\n");
    fixture.turn(|f| f.write("b.txt", "turn two\n"));
    fixture.write("keep.txt", "typed after the last turn\n");

    let plan = fixture.plan(restore_before(first));

    assert_eq!(
        paths_of(&plan.files),
        ["a.txt", "b.txt", "between.txt", "keep.txt"]
    );
    assert_eq!(conflicts_of(&plan.files), ["between.txt", "keep.txt"]);
}

#[test]
fn restore_before_with_no_user_edits_has_no_conflicts() {
    let fixture = Fixture::repo();
    let first = fixture.turn(|f| f.write("a.txt", "turn one\n"));
    fixture.turn(|f| f.write("c.txt", "turn two\n"));

    let plan = fixture.plan(restore_before(first));

    assert_eq!(paths_of(&plan.files), ["a.txt", "c.txt"]);
    assert!(conflicts_of(&plan.files).is_empty());
}

#[test]
fn restore_before_asks_for_confirmation_too() {
    let fixture = Fixture::repo();
    let first = fixture.turn(|f| f.write("a.txt", "turn one\n"));
    fixture.write("a.txt", "turn one, then the user\n");

    let result = fixture.restore(restore_before(first), false);

    assert!(
        matches!(result, RestoreResult::Conflicts { .. }),
        "{result:?}"
    );
    assert_eq!(fixture.read("a.txt"), "turn one, then the user\n");

    fixture.restored(restore_before(first), true);
    assert_eq!(fixture.read("a.txt"), "a1\n");
}
