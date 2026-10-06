use super::support::{Fixture, SESSION, START_TIME};
use crate::checkpoints::model::{DiffQuery, FileStatus};

#[test]
fn a_turn_diff_counts_lines_per_file_and_in_total() {
    let fixture = Fixture::repo();

    let turn = fixture.turn(|f| {
        f.write("a.txt", "a1\nplus one\nplus two\n");
        f.remove("b.txt");
        f.write("c.txt", "1\n2\n3\n");
        f.write_bytes("blob.bin", &[0, 1, 2, 0, 255]);
    });
    let diff = fixture.diff(turn);

    let file = |path: &str| {
        diff.files
            .iter()
            .find(|f| f.path == path)
            .unwrap_or_else(|| panic!("{path} missing from {:?}", diff.files))
    };
    assert_eq!(
        (
            file("a.txt").status,
            file("a.txt").added,
            file("a.txt").removed
        ),
        (FileStatus::Modified, Some(2), Some(0))
    );
    assert_eq!(
        (
            file("b.txt").status,
            file("b.txt").added,
            file("b.txt").removed
        ),
        (FileStatus::Deleted, Some(0), Some(1))
    );
    assert_eq!(
        (
            file("c.txt").status,
            file("c.txt").added,
            file("c.txt").removed
        ),
        (FileStatus::Added, Some(3), Some(0))
    );
    assert_eq!(
        (file("blob.bin").added, file("blob.bin").removed),
        (None, None),
        "binary files have no line counts"
    );
    assert_eq!((diff.added, diff.removed), (5, 1));
    assert_eq!(diff.turn, turn);
    assert_eq!(diff.files.len(), 4);
}

#[test]
fn a_turn_that_changed_nothing_has_an_empty_diff() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|_| {});

    let diff = fixture.diff(turn);

    assert!(diff.files.is_empty());
    assert_eq!((diff.added, diff.removed), (0, 0));
}

#[test]
fn the_listing_has_each_turn_with_its_start_and_end_snapshot() {
    let fixture = Fixture::repo();
    let first_start = fixture.start();
    fixture.advance(5);
    let first_end = fixture.end(first_start.turn);
    fixture.advance(5);
    let second_start = fixture.start();

    let list = fixture.list();

    assert_eq!(list.turns.len(), 2);
    let first = &list.turns[0];
    assert_eq!(first.turn, 1);
    assert_eq!(
        first.start.as_ref().map(|s| s.commit.as_str()),
        Some(first_start.commit.as_str())
    );
    assert_eq!(
        first.end.as_ref().map(|s| s.commit.as_str()),
        Some(first_end.commit.as_str())
    );
    assert_eq!(first.start.as_ref().map(|s| s.created_at), Some(START_TIME));
    assert_eq!(
        first.end.as_ref().map(|s| s.created_at),
        Some(START_TIME + 5)
    );
    let second = &list.turns[1];
    assert_eq!(second.turn, second_start.turn);
    assert!(second.end.is_none(), "a turn in progress has no end yet");
    assert!(list.restores.is_empty());
}

#[test]
fn another_sessions_turns_are_not_listed() {
    let fixture = Fixture::repo();
    fixture.start_session("someone-else");
    fixture.start();

    assert_eq!(fixture.list().turns.len(), 1);
}

#[test]
fn a_session_with_no_snapshots_lists_nothing() {
    let fixture = Fixture::repo();
    let list = fixture.list();
    assert!(list.turns.is_empty() && list.restores.is_empty());
}

#[test]
fn the_diff_of_an_unfinished_turn_says_so() {
    let fixture = Fixture::repo();
    let turn = fixture.start().turn;

    let error = fixture
        .state
        .diff(DiffQuery {
            root: fixture.root_str(),
            session_id: SESSION.to_owned(),
            turn,
        })
        .expect_err("no end snapshot yet");

    assert_eq!(error.code(), "no_checkpoint");
}

#[test]
fn snapshots_survive_a_new_state_object_because_they_live_in_the_repository() {
    let fixture = Fixture::repo();
    let turn = fixture.turn(|f| f.write("a.txt", "agent\n"));

    let reopened = crate::checkpoints::CheckpointState::new(&fixture.data);
    let list = reopened
        .list(crate::checkpoints::model::SessionQuery {
            root: fixture.root_str(),
            session_id: SESSION.to_owned(),
        })
        .expect("list");

    assert_eq!(list.turns.len(), 1);
    assert_eq!(list.turns[0].turn, turn);
}
