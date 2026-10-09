//! Keeps the hidden refs from piling up: a bounded number per session, and nothing from sessions
//! nobody has touched for two weeks. Deleting a ref frees its objects for git's normal garbage
//! collection; the objects themselves are never deleted here.

use std::collections::BTreeMap;

use super::error::CheckpointError;
use super::refs::{self, SessionId, Slot, StoredRef};
use crate::git_cli::Git;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    pub keep_turns: usize,
    pub keep_restores: usize,
    pub max_session_age_secs: i64,
}

impl Policy {
    pub const DEFAULT: Self = Self {
        keep_turns: 50,
        keep_restores: 10,
        max_session_age_secs: 14 * 24 * 60 * 60,
    };
}

/// Drops whole sessions that went quiet, then enforces the limits on the rest.
pub fn prune_stale(git: &Git, now: i64, policy: Policy) -> Result<usize, CheckpointError> {
    let mut sessions: BTreeMap<SessionId, Vec<StoredRef>> = BTreeMap::new();
    for stored in refs::list_all(git)? {
        sessions
            .entry(stored.key.session.clone())
            .or_default()
            .push(stored);
    }
    let mut doomed = Vec::new();
    for stored in sessions.values() {
        if is_stale(stored, now, policy) {
            doomed.extend(stored.iter().map(|s| s.key.name()));
        } else {
            doomed.extend(over_limit(stored, policy));
        }
    }
    refs::update(git, &[], &doomed)?;
    Ok(doomed.len())
}

fn is_stale(session: &[StoredRef], now: i64, policy: Policy) -> bool {
    let newest = session.iter().map(|stored| stored.created_at).max();
    newest.is_some_and(|at| now.saturating_sub(at) > policy.max_session_age_secs)
}

/// Names of the refs of every turn and restore that is not among the newest ones.
pub fn over_limit(session: &[StoredRef], policy: Policy) -> Vec<String> {
    let mut turns: Vec<u32> = Vec::new();
    let mut restores: Vec<u32> = Vec::new();
    for stored in session {
        match stored.key.slot {
            Slot::Turn(turn) => turns.push(turn),
            Slot::Restore(id) => restores.push(id),
        }
    }
    let old_turns = oldest(turns, policy.keep_turns);
    let old_restores = oldest(restores, policy.keep_restores);
    session
        .iter()
        .filter(|stored| match stored.key.slot {
            Slot::Turn(turn) => old_turns.contains(&turn),
            Slot::Restore(id) => old_restores.contains(&id),
        })
        .map(|stored| stored.key.name())
        .collect()
}

fn oldest(mut numbers: Vec<u32>, keep: usize) -> Vec<u32> {
    numbers.sort_unstable();
    numbers.dedup();
    let excess = numbers.len().saturating_sub(keep);
    numbers.truncate(excess);
    numbers
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkpoints::model::Phase;
    use crate::checkpoints::refs::{RefKey, Side};

    const SMALL: Policy = Policy {
        keep_turns: 3,
        keep_restores: 1,
        max_session_age_secs: 100,
    };

    fn session() -> SessionId {
        SessionId::parse("s").expect("id")
    }

    fn stored(key: RefKey, at: i64) -> StoredRef {
        StoredRef {
            key,
            commit: "c".to_owned(),
            tree: "t".to_owned(),
            created_at: at,
        }
    }

    fn turn_pair(turn: u32, at: i64) -> [StoredRef; 2] {
        [
            stored(RefKey::turn(&session(), turn, Phase::Start), at),
            stored(RefKey::turn(&session(), turn, Phase::End), at + 1),
        ]
    }

    #[test]
    fn the_newest_turns_are_kept_and_both_snapshots_of_older_ones_go() {
        let refs: Vec<StoredRef> = (1..=5)
            .flat_map(|turn| turn_pair(turn, i64::from(turn)))
            .collect();
        let doomed = over_limit(&refs, SMALL);
        assert_eq!(
            doomed,
            [
                "refs/flare/checkpoints/s/1/start",
                "refs/flare/checkpoints/s/1/end",
                "refs/flare/checkpoints/s/2/start",
                "refs/flare/checkpoints/s/2/end",
            ]
        );
    }

    #[test]
    fn nothing_is_dropped_within_the_limits() {
        let refs: Vec<StoredRef> = (1..=3).flat_map(|turn| turn_pair(turn, 1)).collect();
        assert!(over_limit(&refs, SMALL).is_empty());
    }

    #[test]
    fn restores_have_their_own_smaller_limit() {
        let refs = vec![
            stored(RefKey::restore(&session(), 1, Side::Before), 1),
            stored(RefKey::restore(&session(), 1, Side::After), 1),
            stored(RefKey::restore(&session(), 2, Side::Before), 2),
            stored(RefKey::restore(&session(), 2, Side::After), 2),
        ];
        let doomed = over_limit(&refs, SMALL);
        assert_eq!(
            doomed,
            [
                "refs/flare/checkpoints/s/restore-1/before",
                "refs/flare/checkpoints/s/restore-1/after"
            ]
        );
    }

    #[test]
    fn a_session_is_stale_only_when_even_its_newest_snapshot_is_old() {
        let mut refs = turn_pair(1, 0).to_vec();
        assert!(
            !is_stale(&refs, 100, SMALL),
            "exactly at the limit is not stale"
        );
        assert!(is_stale(&refs, 102, SMALL));
        refs.extend(turn_pair(2, 150));
        assert!(
            !is_stale(&refs, 200, SMALL),
            "a recent turn keeps the session alive"
        );
    }

    #[test]
    fn a_session_without_refs_is_never_stale() {
        assert!(!is_stale(&[], i64::MAX, SMALL));
    }

    #[test]
    fn the_defaults_match_the_documented_policy() {
        assert_eq!(Policy::DEFAULT.keep_turns, 50);
        assert_eq!(Policy::DEFAULT.max_session_age_secs, 14 * 24 * 3600);
    }
}
