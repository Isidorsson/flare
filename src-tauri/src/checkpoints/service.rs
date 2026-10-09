//! The checkpoint operations for one workspace and session. Callers hold the state lock for
//! anything that writes (see `state.rs`).

use std::collections::HashSet;

use super::apply::apply;
use super::diff::{changed_paths, tree_diff, Change};
use super::error::CheckpointError;
use super::model::{
    CheckpointList, Phase, PlannedFile, RestorePlan, RestoreRequest, RestoreResult, Snapshot,
    TurnDiff,
};
use super::plan::{plan_reset, plan_revert};
use super::prune::{over_limit, Policy};
use super::refs::{self, RefKey, SessionId, Side, StoredRef};
use super::snapshot::{commit_tree, snapshot_tree};
use super::timeline::Timeline;
use super::workspace::Workspace;
use crate::git_cli::Git;

pub struct Checkpoints<'a> {
    pub workspace: &'a Workspace,
    pub session: SessionId,
    pub now: i64,
    pub policy: Policy,
}

/// What a restore would do: the tree to reach and the files that differ from it.
struct Prepared {
    target: String,
    files: Vec<PlannedFile>,
}

impl Checkpoints<'_> {
    /// Snapshots the working tree as the start of the next turn, or as the end of `turn`. Starting
    /// a turn also drops the oldest turns beyond the retention limit, in the same ref transaction.
    pub fn create(&self, phase: Phase, turn: Option<u32>) -> Result<Snapshot, CheckpointError> {
        let existing = refs::list_session(self.git(), &self.session)?;
        let turn = turn_to_record(&Timeline::from_refs(existing.clone()), phase, turn)?;
        let taken = snapshot_tree(self.workspace)?;
        let created = self.commit(RefKey::turn(&self.session, turn, phase), &taken.tree)?;
        let doomed = match phase {
            Phase::Start => over_limit(&with(existing, &created), self.policy),
            Phase::End => Vec::new(),
        };
        refs::update(self.git(), &[&created], &doomed)?;
        Ok(Snapshot {
            session_id: self.session.as_str().to_owned(),
            turn,
            phase,
            commit: created.commit,
            created_at: self.now,
            store: self.workspace.kind(),
            warnings: taken.warnings,
        })
    }

    pub fn list(&self) -> Result<CheckpointList, CheckpointError> {
        Ok(self.timeline()?.to_list(self.workspace.kind()))
    }

    /// What one turn changed: its start snapshot against its end snapshot.
    pub fn turn_diff(&self, turn: u32) -> Result<TurnDiff, CheckpointError> {
        let timeline = self.timeline()?;
        let changes = tree_diff(
            self.git(),
            &timeline.start_of(turn)?.tree,
            &timeline.end_of(turn)?.tree,
        )?;
        let files: Vec<_> = changes.iter().map(Change::to_delta).collect();
        Ok(TurnDiff {
            turn,
            added: files.iter().filter_map(|file| file.added).sum(),
            removed: files.iter().filter_map(|file| file.removed).sum(),
            files,
        })
    }

    /// What `restore` would change right now, without changing anything.
    pub fn plan(&self, request: RestoreRequest) -> Result<RestorePlan, CheckpointError> {
        let current = snapshot_tree(self.workspace)?;
        let prepared = self.prepare(&self.timeline()?, request, &current.tree)?;
        Ok(RestorePlan {
            files: prepared.files,
        })
    }

    /// Restores files after saving the current state as a `before` checkpoint, so the restore can
    /// itself be undone with `RestoreRequest::Redo`.
    pub fn restore(
        &self,
        request: RestoreRequest,
        force: bool,
    ) -> Result<RestoreResult, CheckpointError> {
        let existing = refs::list_session(self.git(), &self.session)?;
        let timeline = Timeline::from_refs(existing.clone());
        let current = snapshot_tree(self.workspace)?;
        let prepared = self.prepare(&timeline, request, &current.tree)?;
        if prepared.files.is_empty() {
            return Ok(RestoreResult::Unchanged);
        }
        if !force && prepared.files.iter().any(|file| file.conflict) {
            return Ok(RestoreResult::Conflicts {
                files: prepared.files,
            });
        }
        let id = timeline.next_restore();
        let before = self.commit(
            RefKey::restore(&self.session, id, Side::Before),
            &current.tree,
        )?;
        refs::update(self.git(), &[&before], &[])?;
        let mut warnings = current.warnings;
        warnings.extend(apply(self.workspace, &prepared.target, &prepared.files)?);
        let after_state = snapshot_tree(self.workspace)?;
        let after = self.commit(
            RefKey::restore(&self.session, id, Side::After),
            &after_state.tree,
        )?;
        let doomed = over_limit(&with(with(existing, &before), &after), self.policy);
        refs::update(self.git(), &[&after], &doomed)?;
        warnings.extend(after_state.warnings);
        Ok(RestoreResult::Restored {
            restore: id,
            files: prepared.files,
            warnings,
        })
    }

    fn prepare(
        &self,
        timeline: &Timeline,
        request: RestoreRequest,
        current: &str,
    ) -> Result<Prepared, CheckpointError> {
        match request {
            RestoreRequest::UndoTurn { turn } => {
                let start = timeline.start_of(turn)?;
                let end = timeline.end_of(turn)?;
                self.reverting(&start.tree, &end.tree, current)
            }
            RestoreRequest::Redo { restore } => {
                let (before, after) = timeline.restore(restore)?;
                self.reverting(&before.tree, &after.tree, current)
            }
            RestoreRequest::RestoreBefore { turn } => {
                let start = timeline.start_of(turn)?;
                let differing = tree_diff(self.git(), current, &start.tree)?;
                let edited = self.edited_outside_turns(timeline, turn, current)?;
                Ok(Prepared {
                    target: start.tree.clone(),
                    files: plan_reset(&differing, &edited),
                })
            }
        }
    }

    /// Undoes what `expected` changed relative to `target`, judged against the files as they are now.
    fn reverting(
        &self,
        target: &str,
        expected: &str,
        current: &str,
    ) -> Result<Prepared, CheckpointError> {
        let span = tree_diff(self.git(), target, expected)?;
        let drift = if expected == current {
            Vec::new()
        } else {
            tree_diff(self.git(), expected, current)?
        };
        Ok(Prepared {
            target: target.to_owned(),
            files: plan_revert(&span, &drift),
        })
    }

    fn edited_outside_turns(
        &self,
        timeline: &Timeline,
        turn: u32,
        current: &str,
    ) -> Result<HashSet<String>, CheckpointError> {
        let mut edited = HashSet::new();
        for (from, to) in timeline.gaps_since(turn, current) {
            edited.extend(changed_paths(self.git(), &from, &to)?);
        }
        Ok(edited)
    }

    /// Commits `tree` for `key`. The ref is created separately, so callers can batch it.
    fn commit(&self, key: RefKey, tree: &str) -> Result<StoredRef, CheckpointError> {
        let message = format!("flare checkpoint {}", key.name());
        let commit = commit_tree(self.git(), tree, &message, self.now)?;
        Ok(StoredRef {
            key,
            commit,
            tree: tree.to_owned(),
            created_at: self.now,
        })
    }

    fn timeline(&self) -> Result<Timeline, CheckpointError> {
        Ok(Timeline::from_refs(refs::list_session(
            self.git(),
            &self.session,
        )?))
    }

    fn git(&self) -> &Git {
        self.workspace.git()
    }
}

fn turn_to_record(
    timeline: &Timeline,
    phase: Phase,
    turn: Option<u32>,
) -> Result<u32, CheckpointError> {
    match (phase, turn) {
        (Phase::Start, _) => Ok(timeline.next_turn()),
        (Phase::End, None) => Err(CheckpointError::InvalidRequest(
            "an end snapshot needs the turn it closes".to_owned(),
        )),
        (Phase::End, Some(turn)) => {
            timeline.start_of(turn)?;
            if timeline.end_of(turn).is_ok() {
                return Err(CheckpointError::InvalidRequest(format!(
                    "turn {turn} already has an end snapshot"
                )));
            }
            Ok(turn)
        }
    }
}

fn with(mut refs: Vec<StoredRef>, added: &StoredRef) -> Vec<StoredRef> {
    refs.push(added.clone());
    refs
}
