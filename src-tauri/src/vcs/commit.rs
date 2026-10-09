use std::time::Duration;

use super::error::VcsError;
use super::repo::Repo;

/// A pre-commit hook may run a formatter or the tests.
const COMMIT_TIMEOUT: Duration = Duration::from_secs(300);

/// The short hash and subject line of the commit just made.
pub struct Committed {
    pub commit: String,
    pub summary: String,
}

/// Commits what is staged. The message goes in on standard input, so no quoting or length limit
/// applies to it; hooks run as usual and their output comes back in the error if they refuse.
pub fn commit(repo: &Repo, message: &str) -> Result<Committed, VcsError> {
    let message = message.trim();
    if message.is_empty() {
        return Err(VcsError::EmptyMessage);
    }
    require_staged(repo)?;
    repo.write(["commit", "--cleanup=whitespace", "-F", "-"])
        .stdin(format!("{message}\n").into_bytes())
        .timeout(COMMIT_TIMEOUT)
        .run()?;
    head_summary(repo)
}

fn require_staged(repo: &Repo) -> Result<(), VcsError> {
    let output = repo
        .read(["diff", "--cached", "--quiet", "--no-ext-diff"])
        .run_unchecked()?;
    match output.code {
        0 => Err(VcsError::NothingStaged),
        1 => Ok(()),
        _ => Err(output.into_error().into()),
    }
}

fn head_summary(repo: &Repo) -> Result<Committed, VcsError> {
    let output = repo
        .read(["log", "-n", "1", "-z", "--format=%h%n%s"])
        .run()?;
    let text = output.text()?;
    let (commit, summary) = text
        .trim_end_matches('\0')
        .split_once('\n')
        .ok_or_else(|| VcsError::output("log", format!("unexpected commit line: {text:?}")))?;
    Ok(Committed {
        commit: commit.to_owned(),
        summary: summary.to_owned(),
    })
}
