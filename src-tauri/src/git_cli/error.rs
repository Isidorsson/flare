use std::io;
use std::path::Path;

/// Why a `git` process could not be run or did not succeed. Features that drive git wrap this in
/// their own error type with a `From` conversion, so the runner stays free of any one feature.
#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("{0} could not be started: install git and make sure it is on your PATH")]
    Missing(String),
    #[error("git {command} failed: {stderr}")]
    Failed { command: String, stderr: String },
    #[error("git {command} did not finish in {seconds} seconds and was stopped")]
    Timeout { command: String, seconds: u64 },
    #[error("unexpected output from git {command}: {detail}")]
    Output { command: String, detail: String },
    #[error("{path}: {source}")]
    Io {
        path: String,
        #[source]
        source: io::Error,
    },
    #[error("{0}")]
    Task(String),
}

impl GitError {
    pub fn io(path: &Path, source: io::Error) -> Self {
        Self::Io {
            path: path.display().to_string(),
            source,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failures_name_the_command_and_the_reason() {
        let error = GitError::Failed {
            command: "add".to_owned(),
            stderr: "boom".to_owned(),
        };
        assert_eq!(error.to_string(), "git add failed: boom");
    }

    #[test]
    fn a_timeout_says_how_long_it_waited() {
        let error = GitError::Timeout {
            command: "push".to_owned(),
            seconds: 600,
        };
        assert_eq!(
            error.to_string(),
            "git push did not finish in 600 seconds and was stopped"
        );
    }

    #[test]
    fn io_errors_name_the_path() {
        let error = GitError::io(Path::new("some/where"), io::Error::other("denied"));
        assert_eq!(error.to_string(), "some/where: denied");
    }
}
