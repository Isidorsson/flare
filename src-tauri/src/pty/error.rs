use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("invalid terminal request: {0}")]
    InvalidRequest(String),
    #[error("terminal session {0} not found")]
    NotFound(String),
    #[error("terminal session {0} already exists")]
    Duplicate(String),
    #[error("terminal session {0} has exited")]
    Exited(String),
    #[error("failed to {action}: {reason}")]
    Backend {
        action: &'static str,
        reason: String,
    },
}

impl PtyError {
    pub fn backend(action: &'static str, cause: impl std::fmt::Display) -> Self {
        Self::Backend {
            action,
            reason: cause.to_string(),
        }
    }
}

impl Serialize for PtyError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_a_plain_message() {
        let json = serde_json::to_string(&PtyError::NotFound("a1".into())).unwrap();
        assert_eq!(json, r#""terminal session a1 not found""#);
    }

    #[test]
    fn backend_errors_name_the_failed_action() {
        let error = PtyError::backend("open pty", "access denied");
        assert_eq!(error.to_string(), "failed to open pty: access denied");
    }
}
