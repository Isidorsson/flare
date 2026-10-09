use std::io;
use std::path::Path;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::git_cli::GitError;

#[derive(Debug, thiserror::Error)]
pub enum VcsError {
    #[error("the Changes tab needs git, but {0} could not be started: install git and make sure it is on your PATH")]
    GitMissing(String),
    #[error("git {command} failed: {stderr}")]
    Git { command: String, stderr: String },
    #[error("git {command} did not finish in {seconds} seconds and was stopped")]
    Timeout { command: String, seconds: u64 },
    #[error("unexpected output from git {command}: {detail}")]
    Output { command: String, detail: String },
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("not a folder: {0}")]
    NotAFolder(String),
    #[error("{0} is not inside a git repository")]
    NotARepository(String),
    #[error("the commit message is empty")]
    EmptyMessage,
    #[error("nothing is staged: stage some changes before committing")]
    NothingStaged,
    #[error("there are no changes to describe")]
    NothingToDescribe,
    #[error("HEAD is detached: switch to a branch first")]
    DetachedHead,
    #[error("{0}")]
    NoRemote(String),
    #[error("branch {0} has no upstream: push it first")]
    NoUpstream(String),
    #[error("{path}: {source}")]
    Io {
        path: String,
        #[source]
        source: io::Error,
    },
    #[error("background task failed: {0}")]
    Task(String),
}

impl VcsError {
    pub fn io(path: &Path, source: io::Error) -> Self {
        Self::Io {
            path: path.display().to_string(),
            source,
        }
    }

    pub fn output(command: &str, detail: impl Into<String>) -> Self {
        Self::Output {
            command: command.to_owned(),
            detail: detail.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::GitMissing(_) => "git_missing",
            Self::Git { .. } => "git",
            Self::Timeout { .. } => "timeout",
            Self::Output { .. } => "output",
            Self::InvalidRequest(_) => "invalid_request",
            Self::NotAFolder(_) => "not_a_folder",
            Self::NotARepository(_) => "not_a_repository",
            Self::EmptyMessage => "empty_message",
            Self::NothingStaged => "nothing_staged",
            Self::NothingToDescribe => "nothing_to_describe",
            Self::DetachedHead => "detached_head",
            Self::NoRemote(_) => "no_remote",
            Self::NoUpstream(_) => "no_upstream",
            Self::Io { .. } => "io",
            Self::Task(_) => "task",
        }
    }
}

impl From<GitError> for VcsError {
    fn from(error: GitError) -> Self {
        match error {
            GitError::Missing(program) => Self::GitMissing(program),
            GitError::Failed { command, stderr } => Self::Git { command, stderr },
            GitError::Timeout { command, seconds } => Self::Timeout { command, seconds },
            GitError::Output { command, detail } => Self::Output { command, detail },
            GitError::Io { path, source } => Self::Io { path, source },
            GitError::Task(message) => Self::Task(message),
        }
    }
}

impl Serialize for VcsError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("VcsError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_and_message() {
        let json = serde_json::to_value(VcsError::NothingStaged).expect("serializes");
        assert_eq!(json["code"], "nothing_staged");
        assert_eq!(
            json["message"],
            "nothing is staged: stage some changes before committing"
        );
    }

    #[test]
    fn runner_errors_keep_their_codes_and_messages() {
        let failed = VcsError::from(GitError::Failed {
            command: "push".to_owned(),
            stderr: "rejected".to_owned(),
        });
        assert_eq!(failed.code(), "git");
        assert_eq!(failed.to_string(), "git push failed: rejected");
        assert_eq!(
            VcsError::from(GitError::Missing("git".to_owned())).code(),
            "git_missing"
        );
        let timeout = VcsError::from(GitError::Timeout {
            command: "fetch".to_owned(),
            seconds: 600,
        });
        assert_eq!(timeout.code(), "timeout");
    }
}
