use std::io;
use std::path::Path;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum FsError {
    #[error("no workspace is open")]
    NoWorkspace,
    #[error("path is outside the workspace: {0}")]
    OutsideWorkspace(String),
    #[error("path is protected and cannot be modified: {0}")]
    ProtectedPath(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("not a directory: {0}")]
    NotADirectory(String),
    #[error("is a directory: {0}")]
    IsADirectory(String),
    #[error("{path}: {source}")]
    Io {
        path: String,
        #[source]
        source: io::Error,
    },
    #[error("file watcher failed: {0}")]
    Watch(#[from] notify::Error),
    #[error("background task failed: {0}")]
    Task(String),
}

impl FsError {
    pub fn io(path: &Path, source: io::Error) -> Self {
        let path = path.display().to_string();
        match source.kind() {
            io::ErrorKind::NotFound => Self::NotFound(path),
            _ => Self::Io { path, source },
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::NoWorkspace => "no_workspace",
            Self::OutsideWorkspace(_) => "outside_workspace",
            Self::ProtectedPath(_) => "protected_path",
            Self::NotFound(_) => "not_found",
            Self::NotADirectory(_) => "not_a_directory",
            Self::IsADirectory(_) => "is_a_directory",
            Self::Io { .. } => "io",
            Self::Watch(_) => "watch",
            Self::Task(_) => "task",
        }
    }
}

impl Serialize for FsError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("FsError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_io_errors_become_not_found() {
        let error = FsError::io(Path::new("a/b"), io::Error::from(io::ErrorKind::NotFound));
        assert_eq!(error.code(), "not_found");
    }

    #[test]
    fn other_io_errors_keep_their_source() {
        let error = FsError::io(
            Path::new("a/b"),
            io::Error::from(io::ErrorKind::PermissionDenied),
        );
        assert_eq!(error.code(), "io");
        assert!(error.to_string().starts_with("a/b"));
    }

    #[test]
    fn serializes_code_and_message() {
        let json = serde_json::to_value(FsError::NoWorkspace).expect("serializes");
        assert_eq!(json["code"], "no_workspace");
        assert_eq!(json["message"], "no workspace is open");
    }
}
