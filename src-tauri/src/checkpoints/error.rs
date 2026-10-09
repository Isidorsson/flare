use std::io;
use std::path::Path;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::git_cli::GitError;

#[derive(Debug, thiserror::Error)]
pub enum CheckpointError {
    #[error("checkpoints need git, but {0} could not be started: install git and make sure it is on your PATH")]
    GitMissing(String),
    #[error("git {command} failed: {stderr}")]
    Git { command: String, stderr: String },
    #[error("git {command} did not finish in {seconds} seconds and was stopped")]
    Timeout { command: String, seconds: u64 },
    #[error("unexpected output from git {command}: {detail}")]
    Output { command: String, detail: String },
    #[error("invalid checkpoint request: {0}")]
    InvalidRequest(String),
    #[error("not a folder: {0}")]
    NotAFolder(String),
    #[error(
        "{path} holds more than {limit} files and is not a git repository, so checkpoints would be slow: run `git init` there (and ignore build output) to enable them"
    )]
    TooLarge { path: String, limit: usize },
    #[error("{0}")]
    NoCheckpoint(String),
    #[error("{path}: {source}")]
    Io {
        path: String,
        #[source]
        source: io::Error,
    },
    #[error("background task failed: {0}")]
    Task(String),
}

impl CheckpointError {
    pub fn io(path: &Path, source: io::Error) -> Self {
        Self::Io {
            path: path.display().to_string(),
            source,
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
            Self::TooLarge { .. } => "too_large",
            Self::NoCheckpoint(_) => "no_checkpoint",
            Self::Io { .. } => "io",
            Self::Task(_) => "task",
        }
    }
}

impl From<GitError> for CheckpointError {
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

impl Serialize for CheckpointError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("CheckpointError", 2)?;
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
        let json = serde_json::to_value(CheckpointError::NoCheckpoint("turn 3 is gone".to_owned()))
            .expect("serializes");
        assert_eq!(json["code"], "no_checkpoint");
        assert_eq!(json["message"], "turn 3 is gone");
    }

    #[test]
    fn runner_errors_keep_their_codes_and_messages() {
        let failed = CheckpointError::from(GitError::Failed {
            command: "add".to_owned(),
            stderr: "boom".to_owned(),
        });
        assert_eq!(failed.code(), "git");
        assert_eq!(failed.to_string(), "git add failed: boom");
        let missing = CheckpointError::from(GitError::Missing("git".to_owned()));
        assert_eq!(missing.code(), "git_missing");
        let timeout = CheckpointError::from(GitError::Timeout {
            command: "gc".to_owned(),
            seconds: 5,
        });
        assert_eq!(timeout.code(), "timeout");
    }

    #[test]
    fn git_failures_name_the_command_and_the_reason() {
        let error = CheckpointError::Git {
            command: "add".to_owned(),
            stderr: "boom".to_owned(),
        };
        assert_eq!(error.to_string(), "git add failed: boom");
        assert_eq!(error.code(), "git");
    }
}
