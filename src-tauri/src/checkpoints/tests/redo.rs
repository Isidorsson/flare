use super::support::{conflicts_of, Fixture};
use crate::checkpoints::model::{RestoreRequest, RestoreResult};

fn undo(turn: u32) -> RestoreRequest {
    RestoreRequest::UndoTurn { turn }
}

fn redo(restore: u32) -> RestoreRequest {
    RestoreRequest::Redo { restore }
}

fn agent_turn(fixture: &Fixture) -> u32 {
    fixture.turn(|f| {
        f.write("a.txt", "a by the agent\n");
        f.remove("b.txt");
        f.write("made/c.txt", "created by the agent\n");
    })
}

#[test]
fn redo_brings_back_exactly_what_the_undo_removed() {
    let fixture = Fixture::repo();
    let turn = agent_turn(&fixture);
    let id = fixture.restored(undo(turn), false);
    assert_eq!(fixture.read("a.txt"), "a1\n");

    fixture.restored(redo(id), false);

    assert_eq!(fixture.read("a.txt"), "a by the agent\n");
    assert!(!fixture.exists("b.txt"));
    assert_eq!(fixture.read("made/c.txt"), "created by the agent\n");
    assert_eq!(fixture.read("keep.txt"), "keep\n");
}

#[test]
fn an_undo_can_be_undone_and_done_again_repeatedly() {
    let fixture = Fixture::repo();
    let turn = agent_turn(&fixture);

    let first_undo = fixture.restored(undo(turn), false);
    let redone = fixture.restored(redo(first_undo), false);
    let second_undo = fixture.restored(undo(turn), false);

    assert_eq!((first_undo, redone, second_undo), (1, 2, 3));
    assert_eq!(fixture.read("a.txt"), "a1\n");
    assert!(fixture.exists("b.txt"));
    assert!(!fixture.exists("made/c.txt"));
}

#[test]
fn a_redo_can_itself_be_undone() {
    let fixture = Fixture::repo();
    let turn = agent_turn(&fixture);
    let undone = fixture.restored(undo(turn), false);
    let redone = fixture.restored(redo(undone), false);

    fixture.restored(redo(redone), false);

    assert_eq!(fixture.read("a.txt"), "a1\n", "back to the undone state");
}

#[test]
fn redo_warns_about_edits_made_after_the_undo() {
    let fixture = Fixture::repo();
    let turn = agent_turn(&fixture);
    let id = fixture.restored(undo(turn), false);
    fixture.write("a.txt", "the user kept working after the undo\n");

    let result = fixture.restore(redo(id), false);

    let RestoreResult::Conflicts { files } = result else {
        panic!("expected conflicts, got {result:?}");
    };
    assert_eq!(conflicts_of(&files), ["a.txt"]);
    assert_eq!(
        fixture.read("a.txt"),
        "the user kept working after the undo\n"
    );

    fixture.restored(redo(id), true);
    assert_eq!(fixture.read("a.txt"), "a by the agent\n");
}

#[test]
fn redo_touches_only_the_files_the_undo_changed() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|f| f.write("a.txt", "agent\n"));
    let id = fixture.restored(undo(turn), false);
    fixture.write("keep.txt", "edited after undo\n");
    fixture.write("new-after-undo.txt", "x\n");

    fixture.restored(redo(id), false);

    assert_eq!(fixture.read("a.txt"), "agent\n");
    assert_eq!(fixture.read("keep.txt"), "edited after undo\n");
    assert_eq!(fixture.read("new-after-undo.txt"), "x\n");
}

#[test]
fn redo_works_for_a_restore_to_before_a_turn() {
    let fixture = Fixture::repo();
    let first = fixture.turn(|f| f.write("a.txt", "one\n"));
    fixture.turn(|f| f.write("b.txt", "two\n"));
    let id = fixture.restored(RestoreRequest::RestoreBefore { turn: first }, false);
    assert_eq!(fixture.read("a.txt"), "a1\n");

    fixture.restored(redo(id), false);

    assert_eq!(fixture.read("a.txt"), "one\n");
    assert_eq!(fixture.read("b.txt"), "two\n");
}

#[test]
fn the_listing_shows_a_restore_as_complete_once_it_has_happened() {
    let fixture = Fixture::repo();
    let turn = agent_turn(&fixture);
    assert!(fixture.list().restores.is_empty());

    let id = fixture.restored(undo(turn), false);

    let restores = fixture.list().restores;
    assert_eq!(restores.len(), 1);
    assert_eq!(restores[0].id, id);
    assert!(restores[0].complete);
}

#[test]
fn undoing_something_that_a_redo_would_conflict_with_still_keeps_the_user_edit_recoverable() {
    let fixture = Fixture::repo();
    let turn = agent_turn(&fixture);
    let undone = fixture.restored(undo(turn), false);
    fixture.write("a.txt", "work after undo\n");

    let redone = fixture.restored(redo(undone), true);
    fixture.restored(redo(redone), false);

    assert_eq!(fixture.read("a.txt"), "work after undo\n");
}
