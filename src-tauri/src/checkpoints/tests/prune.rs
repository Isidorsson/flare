use super::support::{Fixture, SESSION};
use crate::checkpoints::model::RestoreRequest;
use crate::checkpoints::prune::Policy;

const DAY: i64 = 24 * 60 * 60;

const SMALL: Policy = Policy {
    keep_turns: 3,
    keep_restores: 1,
    max_session_age_secs: 14 * DAY,
};

fn turn_numbers(fixture: &Fixture) -> Vec<u32> {
    fixture.list().turns.iter().map(|turn| turn.turn).collect()
}

#[test]
fn only_the_newest_turns_are_kept_when_a_new_turn_starts() {
    let fixture = Fixture::with_policy(SMALL);

    for n in 0..5 {
        fixture.turn(|f| f.write("a.txt", &format!("turn {n}\n")));
    }

    assert_eq!(turn_numbers(&fixture), [3, 4, 5]);
    let refs = fixture.flare_refs();
    assert_eq!(refs.len(), 6, "start and end of each kept turn: {refs:?}");
    assert!(refs
        .iter()
        .all(|name| !name.contains("/1/") && !name.contains("/2/")));
}

#[test]
fn turn_numbers_keep_counting_after_old_turns_are_pruned() {
    let fixture = Fixture::with_policy(SMALL);
    for _ in 0..4 {
        fixture.turn(|_| {});
    }

    assert_eq!(fixture.start().turn, 5);
}

#[test]
fn restore_checkpoints_are_limited_too() {
    let fixture = Fixture::with_policy(SMALL);
    let turn = fixture.turn(|f| f.write("a.txt", "agent\n"));
    let first = fixture.restored(RestoreRequest::UndoTurn { turn }, false);
    fixture.restored(RestoreRequest::Redo { restore: first }, false);

    let restores = fixture.list().restores;

    assert_eq!(restores.len(), 1, "only the newest restore is kept");
    assert_eq!(restores[0].id, 2);
}

#[test]
fn sessions_untouched_for_over_two_weeks_are_deleted_and_active_ones_stay() {
    let fixture = Fixture::with_policy(SMALL);
    fixture.start_session("old-session");
    fixture.advance(14 * DAY + 1);
    fixture.start_session("fresh-session");

    let report = fixture.prune();

    assert_eq!(report.removed_refs, 1);
    let refs = fixture.flare_refs();
    assert!(
        refs.iter().all(|name| !name.contains("old-session")),
        "{refs:?}"
    );
    assert!(
        refs.iter().any(|name| name.contains("fresh-session")),
        "{refs:?}"
    );
}

#[test]
fn a_session_with_one_recent_snapshot_is_not_stale() {
    let fixture = Fixture::with_policy(SMALL);
    fixture.start();
    fixture.advance(13 * DAY);
    fixture.start();
    fixture.advance(13 * DAY);

    assert_eq!(fixture.prune().removed_refs, 0);
    assert_eq!(turn_numbers(&fixture), [1, 2]);
}

#[test]
fn pruning_never_touches_branches_tags_the_stash_or_other_hidden_refs() {
    let fixture = Fixture::with_policy(SMALL);
    fixture.git(&["tag", "v1"]);
    fixture.git(&["update-ref", "refs/flare/other/keep", "HEAD"]);
    fixture.write("a.txt", "stashed\n");
    fixture.git(&["stash", "push", "--quiet", "-m", "wip"]);
    fixture.start();
    fixture.advance(30 * DAY);
    let others = || {
        fixture.git(&[
            "for-each-ref",
            "--format=%(refname) %(objectname)",
            "refs/heads/",
            "refs/tags/",
            "refs/stash",
            "refs/flare/other/",
        ])
    };
    let before = others();

    assert_eq!(fixture.prune().removed_refs, 1);

    assert_eq!(others(), before);
    assert!(fixture
        .flare_refs()
        .iter()
        .all(|name| !name.contains(SESSION)));
}

#[test]
fn pruning_a_folder_that_never_had_a_checkpoint_creates_nothing() {
    let fixture = Fixture::plain();

    let report = fixture.prune();

    assert_eq!(report.removed_refs, 0);
    assert!(
        !fixture.data.join("checkpoints").exists(),
        "no private repository is made just to prune it"
    );
}

#[test]
fn pruned_refs_free_their_snapshots_for_garbage_collection() {
    let fixture = Fixture::with_policy(SMALL);
    fixture.write("unique.txt", "only in the first snapshot\n");
    let first = fixture.start();
    fixture.remove("unique.txt");
    for _ in 0..4 {
        fixture.start();
    }

    let reachable = fixture.git(&["rev-list", "--all"]);

    assert!(
        !reachable.lines().any(|commit| commit == first.commit),
        "the pruned snapshot is no longer referenced"
    );
}
