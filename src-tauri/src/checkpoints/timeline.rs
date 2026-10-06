//! One session's snapshots, grouped into turns and restores, in the order they happened.

use std::collections::BTreeMap;

use super::error::CheckpointError;
use super::model::{CheckpointList, RestoreEntry, SnapshotRef, StoreKind, TurnEntry};
use super::refs::{Side, Slot, StoredRef};

#[derive(Debug, Default, Clone)]
pub struct TurnRefs {
    pub start: Option<StoredRef>,
    pub end: Option<StoredRef>,
}

#[derive(Debug, Default, Clone)]
pub struct RestoreRefs {
    pub before: Option<StoredRef>,
    pub after: Option<StoredRef>,
}

#[derive(Debug, Default, Clone)]
pub struct Timeline {
    turns: BTreeMap<u32, TurnRefs>,
    restores: BTreeMap<u32, RestoreRefs>,
}

impl Timeline {
    pub fn from_refs(refs: Vec<StoredRef>) -> Self {
        let mut timeline = Self::default();
        for stored in refs {
            match (stored.key.slot, stored.key.side) {
                (Slot::Turn(turn), Side::Start) => {
                    timeline.turns.entry(turn).or_default().start = Some(stored);
                }
                (Slot::Turn(turn), _) => timeline.turns.entry(turn).or_default().end = Some(stored),
                (Slot::Restore(id), Side::Before) => {
                    timeline.restores.entry(id).or_default().before = Some(stored);
                }
                (Slot::Restore(id), _) => {
                    timeline.restores.entry(id).or_default().after = Some(stored);
                }
            }
        }
        timeline
    }

    pub fn next_turn(&self) -> u32 {
        self.turns.keys().next_back().map_or(1, |last| last + 1)
    }

    pub fn next_restore(&self) -> u32 {
        self.restores.keys().next_back().map_or(1, |last| last + 1)
    }

    pub fn start_of(&self, turn: u32) -> Result<&StoredRef, CheckpointError> {
        self.turns
            .get(&turn)
            .and_then(|refs| refs.start.as_ref())
            .ok_or_else(|| {
                CheckpointError::NoCheckpoint(format!(
                    "there is no snapshot from before turn {turn}"
                ))
            })
    }

    pub fn end_of(&self, turn: u32) -> Result<&StoredRef, CheckpointError> {
        self.turns
            .get(&turn)
            .and_then(|refs| refs.end.as_ref())
            .ok_or_else(|| {
                CheckpointError::NoCheckpoint(format!("turn {turn} has no snapshot from after it"))
            })
    }

    /// The safety snapshot a restore took and the state it left behind.
    pub fn restore(&self, id: u32) -> Result<(&StoredRef, &StoredRef), CheckpointError> {
        let refs = self.restores.get(&id);
        match refs.and_then(|r| r.before.as_ref().zip(r.after.as_ref())) {
            Some(pair) => Ok(pair),
            None => Err(CheckpointError::NoCheckpoint(format!(
                "restore {id} cannot be undone: its snapshots are missing"
            ))),
        }
    }

    /// Pairs of trees spanning time the agent did not account for: from the end of a turn to the
    /// start of the next one, and from the newest snapshot to `current`. Whatever differs inside a
    /// pair was changed by the user (or another program), not by a recorded turn.
    pub fn gaps_since(&self, turn: u32, current_tree: &str) -> Vec<(String, String)> {
        let mut gaps = Vec::new();
        let mut previous: Option<&str> = None;
        for refs in self.turns.range(turn..).map(|(_, refs)| refs) {
            if let (Some(before), Some(start)) = (previous, refs.start.as_ref()) {
                gaps.push((before.to_owned(), start.tree.clone()));
            }
            previous = refs
                .end
                .as_ref()
                .or(refs.start.as_ref())
                .map(|stored| stored.tree.as_str());
        }
        if let Some(last) = previous {
            gaps.push((last.to_owned(), current_tree.to_owned()));
        }
        gaps.retain(|(from, to)| from != to);
        gaps
    }

    pub fn to_list(&self, store: StoreKind) -> CheckpointList {
        CheckpointList {
            store,
            turns: self
                .turns
                .iter()
                .map(|(turn, refs)| TurnEntry {
                    turn: *turn,
                    start: refs.start.as_ref().map(snapshot_ref),
                    end: refs.end.as_ref().map(snapshot_ref),
                })
                .collect(),
            restores: self
                .restores
                .iter()
                .filter_map(|(id, refs)| restore_entry(*id, refs))
                .collect(),
        }
    }
}

fn snapshot_ref(stored: &StoredRef) -> SnapshotRef {
    SnapshotRef {
        commit: stored.commit.clone(),
        created_at: stored.created_at,
    }
}

fn restore_entry(id: u32, refs: &RestoreRefs) -> Option<RestoreEntry> {
    let created_at = refs.before.as_ref().or(refs.after.as_ref())?.created_at;
    Some(RestoreEntry {
        id,
        created_at,
        complete: refs.before.is_some() && refs.after.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkpoints::model::Phase;
    use crate::checkpoints::refs::{RefKey, SessionId};

    fn stored(key: RefKey, tree: &str, at: i64) -> StoredRef {
        StoredRef {
            commit: format!("c-{tree}"),
            tree: tree.to_owned(),
            created_at: at,
            key,
        }
    }

    fn turn_ref(turn: u32, phase: Phase, tree: &str) -> StoredRef {
        let session = SessionId::parse("s").expect("id");
        stored(
            RefKey::turn(&session, turn, phase),
            tree,
            i64::from(turn) * 10,
        )
    }

    fn sample() -> Timeline {
        Timeline::from_refs(vec![
            turn_ref(1, Phase::Start, "t1s"),
            turn_ref(1, Phase::End, "t1e"),
            turn_ref(2, Phase::Start, "t2s"),
            turn_ref(2, Phase::End, "t2e"),
            turn_ref(3, Phase::Start, "t3s"),
        ])
    }

    #[test]
    fn numbering_continues_after_the_newest_turn() {
        assert_eq!(Timeline::default().next_turn(), 1);
        assert_eq!(sample().next_turn(), 4);
        assert_eq!(Timeline::default().next_restore(), 1);
    }

    #[test]
    fn missing_snapshots_say_what_is_missing() {
        let timeline = sample();
        assert_eq!(timeline.start_of(2).expect("start").tree, "t2s");
        assert_eq!(timeline.end_of(2).expect("end").tree, "t2e");
        let unfinished = timeline.end_of(3).expect_err("no end yet");
        assert_eq!(unfinished.code(), "no_checkpoint");
        assert!(timeline.start_of(9).is_err());
    }

    #[test]
    fn gaps_skip_identical_trees_and_end_at_the_current_one() {
        let timeline = Timeline::from_refs(vec![
            turn_ref(1, Phase::Start, "a"),
            turn_ref(1, Phase::End, "b"),
            turn_ref(2, Phase::Start, "b"),
            turn_ref(2, Phase::End, "c"),
            turn_ref(3, Phase::Start, "d"),
            turn_ref(3, Phase::End, "e"),
        ]);
        let gaps = timeline.gaps_since(1, "f");
        assert_eq!(
            gaps,
            vec![
                ("c".to_owned(), "d".to_owned()),
                ("e".to_owned(), "f".to_owned())
            ]
        );
    }

    #[test]
    fn gaps_only_cover_turns_from_the_requested_one() {
        let timeline = sample();
        let gaps = timeline.gaps_since(3, "now");
        assert_eq!(gaps, vec![("t3s".to_owned(), "now".to_owned())]);
    }

    #[test]
    fn an_unchanged_workspace_has_no_gaps() {
        let timeline = Timeline::from_refs(vec![
            turn_ref(1, Phase::Start, "a"),
            turn_ref(1, Phase::End, "b"),
        ]);
        assert!(timeline.gaps_since(1, "b").is_empty());
    }

    #[test]
    fn restores_need_both_snapshots_to_be_undone() {
        let session = SessionId::parse("s").expect("id");
        let before = stored(RefKey::restore(&session, 1, Side::Before), "x", 5);
        let timeline = Timeline::from_refs(vec![before.clone()]);
        assert!(timeline.restore(1).is_err());
        let list = timeline.to_list(StoreKind::Git);
        assert_eq!(list.restores.len(), 1);
        assert!(!list.restores[0].complete);

        let after = stored(RefKey::restore(&session, 1, Side::After), "y", 6);
        let timeline = Timeline::from_refs(vec![before, after]);
        let (b, a) = timeline.restore(1).expect("complete");
        assert_eq!((b.tree.as_str(), a.tree.as_str()), ("x", "y"));
        assert!(timeline.to_list(StoreKind::Git).restores[0].complete);
    }

    #[test]
    fn the_list_has_every_turn_in_order() {
        let list = sample().to_list(StoreKind::Private);
        assert_eq!(list.store, StoreKind::Private);
        let numbers: Vec<u32> = list.turns.iter().map(|t| t.turn).collect();
        assert_eq!(numbers, [1, 2, 3]);
        assert!(list.turns[2].end.is_none());
    }
}
