//! The shapes exchanged with the webview. The zod schemas in `src/features/checkpoints/` mirror them.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Start,
    End,
}

/// Where the snapshots live: the user's own repository or Flare's private one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StoreKind {
    Git,
    Private,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
    pub root: String,
    pub session_id: String,
    pub phase: Phase,
    /// Required for `end`; `start` opens the next turn number.
    pub turn: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub session_id: String,
    pub turn: u32,
    pub phase: Phase,
    pub commit: String,
    pub created_at: i64,
    pub store: StoreKind,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionQuery {
    pub root: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffQuery {
    pub root: String,
    pub session_id: String,
    pub turn: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneQuery {
    pub root: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRef {
    pub commit: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnEntry {
    pub turn: u32,
    pub start: Option<SnapshotRef>,
    pub end: Option<SnapshotRef>,
}

/// A restore leaves a `before` snapshot (taken first, so it can be undone) and an `after` one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreEntry {
    pub id: u32,
    pub created_at: i64,
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointList {
    pub store: StoreKind,
    pub turns: Vec<TurnEntry>,
    pub restores: Vec<RestoreEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
}

/// `added` and `removed` are absent for binary files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDelta {
    pub path: String,
    pub status: FileStatus,
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnDiff {
    pub turn: u32,
    pub files: Vec<FileDelta>,
    pub added: u32,
    pub removed: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RestoreRequest {
    /// Put back the files one turn changed, leaving every other file alone.
    UndoTurn { turn: u32 },
    /// Roll the whole workspace back to how it was before a turn, discarding that turn and later ones.
    RestoreBefore { turn: u32 },
    /// Undo an earlier restore.
    Redo { restore: u32 },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanQuery {
    pub root: String,
    pub session_id: String,
    pub request: RestoreRequest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreCommand {
    pub root: String,
    pub session_id: String,
    pub request: RestoreRequest,
    /// Overwrite files that changed after the turn, once the user has seen which they are.
    pub force: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileAction {
    /// The file exists now and goes back to older content.
    Revert,
    /// The file did not exist then; it is removed.
    Delete,
    /// The file was deleted since; it is written again.
    Recreate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedFile {
    pub path: String,
    pub action: FileAction,
    /// The file changed after the point being restored from, so restoring discards that change.
    pub conflict: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePlan {
    pub files: Vec<PlannedFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RestoreResult {
    /// `restore` identifies the safety checkpoint; `Redo` with it undoes this restore.
    Restored {
        restore: u32,
        files: Vec<PlannedFile>,
        warnings: Vec<String>,
    },
    /// Nothing was touched: some files changed after the turn and `force` was not set.
    Conflicts { files: Vec<PlannedFile> },
    /// The files already match; nothing to do.
    Unchanged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneReport {
    pub removed_refs: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_requests_are_tagged_by_kind() {
        let undo: RestoreRequest =
            serde_json::from_str(r#"{"kind":"undoTurn","turn":3}"#).expect("undo");
        assert_eq!(undo, RestoreRequest::UndoTurn { turn: 3 });
        let before: RestoreRequest =
            serde_json::from_str(r#"{"kind":"restoreBefore","turn":1}"#).expect("before");
        assert_eq!(before, RestoreRequest::RestoreBefore { turn: 1 });
        let redo: RestoreRequest =
            serde_json::from_str(r#"{"kind":"redo","restore":2}"#).expect("redo");
        assert_eq!(redo, RestoreRequest::Redo { restore: 2 });
    }

    #[test]
    fn unknown_restore_kinds_are_rejected() {
        let parsed = serde_json::from_str::<RestoreRequest>(r#"{"kind":"nuke","turn":1}"#);
        assert!(parsed.is_err());
    }

    #[test]
    fn create_requests_use_camel_case() {
        let request: CreateRequest =
            serde_json::from_str(r#"{"root":"C:/w","sessionId":"s1","phase":"end","turn":2}"#)
                .expect("create");
        assert_eq!(request.session_id, "s1");
        assert_eq!(request.phase, Phase::End);
        assert_eq!(request.turn, Some(2));
    }

    #[test]
    fn restore_results_carry_a_status_tag() {
        let json = serde_json::to_value(RestoreResult::Unchanged).expect("serializes");
        assert_eq!(json["status"], "unchanged");
        let json = serde_json::to_value(RestoreResult::Conflicts { files: Vec::new() })
            .expect("serializes");
        assert_eq!(json["status"], "conflicts");
    }
}
