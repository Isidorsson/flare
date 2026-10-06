use std::fmt;

use serde::{Serialize, Serializer};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphError {
    NotIndexed,
    InvalidRoot(String),
    OutsideWorkspace(String),
    UnknownFile(String),
    Io { path: String, message: String },
    Parse { path: String },
    Poisoned,
    Task(String),
}

impl GraphError {
    pub fn io(path: impl Into<String>, error: &std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            message: error.to_string(),
        }
    }
}

impl fmt::Display for GraphError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotIndexed => write!(f, "the workspace has not been indexed yet"),
            Self::InvalidRoot(root) => write!(f, "cannot index workspace root {root}"),
            Self::OutsideWorkspace(path) => write!(f, "{path} is outside the indexed workspace"),
            Self::UnknownFile(path) => write!(f, "{path} is not part of the graph"),
            Self::Io { path, message } => write!(f, "failed to read {path}: {message}"),
            Self::Parse { path } => write!(f, "failed to parse {path}"),
            Self::Poisoned => write!(f, "the graph index lock was poisoned by a panic"),
            Self::Task(message) => write!(f, "graph task failed: {message}"),
        }
    }
}

impl std::error::Error for GraphError {}

impl Serialize for GraphError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_as_its_display_message() {
        let json = serde_json::to_string(&GraphError::UnknownFile("src/a.ts".into())).unwrap();
        assert_eq!(json, "\"src/a.ts is not part of the graph\"");
    }

    #[test]
    fn io_errors_carry_the_path() {
        let source = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        let error = GraphError::io("src/a.ts", &source);
        assert_eq!(error.to_string(), "failed to read src/a.ts: denied");
    }
}
