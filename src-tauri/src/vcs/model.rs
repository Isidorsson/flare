//! The shapes exchanged with the webview. The zod schemas in `src/features/vcs/` mirror them.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Change {
    Added,
    Modified,
    Deleted,
    Renamed,
    TypeChanged,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsFile {
    pub path: String,
    pub orig_path: Option<String>,
    pub staged: Option<Change>,
    pub unstaged: Option<Change>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsStatus {
    pub is_repo: bool,
    /// `None` while HEAD is detached.
    pub branch: Option<String>,
    /// Short hash of HEAD; `None` before the first commit.
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<VcsFile>,
}

impl VcsStatus {
    pub fn not_a_repo() -> Self {
        Self {
            is_repo: false,
            branch: None,
            head: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            files: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub original: Option<String>,
    pub modified: Option<String>,
    /// Binary content, or too large to show as text; both texts are `None`.
    pub binary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    /// Short hash of the new commit.
    pub commit: String,
    pub summary: String,
    pub status: VcsStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsBranch {
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffSource {
    Staged,
    All,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageContext {
    pub source: DiffSource,
    pub stat: String,
    pub patch: String,
    pub truncated: bool,
    /// `None` while HEAD is detached.
    pub branch: Option<String>,
    pub recent_subjects: Vec<String>,
    /// Bodies of the newest commits that have one, newest first.
    pub recent_bodies: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootRequest {
    pub root: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffRequest {
    pub root: String,
    pub path: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsRequest {
    pub root: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    pub root: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchRequest {
    pub root: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBranchRequest {
    pub root: String,
    pub name: String,
    pub force: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_serializes_with_camel_case_names_and_nulls() {
        let status = VcsStatus {
            is_repo: true,
            branch: None,
            head: Some("abc1234".to_owned()),
            upstream: None,
            ahead: 1,
            behind: 2,
            files: vec![VcsFile {
                path: "a.txt".to_owned(),
                orig_path: None,
                staged: Some(Change::TypeChanged),
                unstaged: None,
            }],
        };
        let json = serde_json::to_value(status).expect("serializes");
        assert_eq!(json["isRepo"], true);
        assert!(json["branch"].is_null());
        assert_eq!(json["head"], "abc1234");
        assert_eq!(json["files"][0]["staged"], "typeChanged");
        assert!(json["files"][0]["origPath"].is_null());
        assert!(json["files"][0]["unstaged"].is_null());
    }

    #[test]
    fn every_change_has_its_contract_name() {
        let names: Vec<String> = [
            Change::Added,
            Change::Modified,
            Change::Deleted,
            Change::Renamed,
            Change::TypeChanged,
            Change::Untracked,
            Change::Conflicted,
        ]
        .iter()
        .map(|change| {
            serde_json::to_value(change)
                .expect("serializes")
                .as_str()
                .expect("a string")
                .to_owned()
        })
        .collect();
        assert_eq!(
            names,
            [
                "added",
                "modified",
                "deleted",
                "renamed",
                "typeChanged",
                "untracked",
                "conflicted"
            ]
        );
    }

    #[test]
    fn message_context_and_diff_use_the_contract_field_names() {
        let context = MessageContext {
            source: DiffSource::Staged,
            stat: String::new(),
            patch: String::new(),
            truncated: false,
            branch: Some("feat/login".to_owned()),
            recent_subjects: vec!["feat: x".to_owned()],
            recent_bodies: vec!["Why.".to_owned()],
        };
        let json = serde_json::to_value(context).expect("serializes");
        assert_eq!(json["source"], "staged");
        assert_eq!(json["branch"], "feat/login");
        assert_eq!(json["recentSubjects"][0], "feat: x");
        assert_eq!(json["recentBodies"][0], "Why.");
        let diff = serde_json::to_value(FileDiff {
            path: "a".to_owned(),
            original: None,
            modified: Some("x".to_owned()),
            binary: false,
        })
        .expect("serializes");
        assert!(diff["original"].is_null());
        assert_eq!(diff["binary"], false);
    }

    #[test]
    fn requests_deserialize_from_camel_case() {
        let request: DeleteBranchRequest =
            serde_json::from_str(r#"{"root":"/r","name":"x","force":true}"#).expect("parses");
        assert!(request.force);
        let diff: FileDiffRequest =
            serde_json::from_str(r#"{"root":"/r","path":"a","staged":false}"#).expect("parses");
        assert!(!diff.staged);
        let missing = serde_json::from_str::<PathsRequest>(r#"{"root":"/r"}"#);
        assert!(missing.is_err(), "paths is required, even when empty");
    }
}
