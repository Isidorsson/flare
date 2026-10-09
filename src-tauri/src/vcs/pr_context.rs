//! What a pull request from the current branch would contain: its commits and a summary of the
//! changes, measured from the point where the branch left `base`. This is what a generator is
//! shown to write the title and description.

use super::branches::validate_name;
use super::error::VcsError;
use super::message_context::{stat_text, RECENT_BODY_LIMIT};
use super::model::{PrCommit, PrContext};
use super::repo::Repo;
use super::text::{cap_chars, lossy};

/// Commits sent in total. A longer branch keeps its newest commits and says it was cut.
pub const PR_COMMIT_LIMIT: usize = 50;
const COMMIT_BODY_LIMIT: usize = RECENT_BODY_LIMIT;
const ORIGIN_REFS: &str = "refs/remotes/origin/";
const LOCAL_REFS: &str = "refs/heads/";

pub fn read(repo: &Repo, base: &str) -> Result<PrContext, VcsError> {
    validate_name(repo, base)?;
    let branch = repo.require_branch()?;
    if branch == base {
        return Err(VcsError::OnBaseBranch(branch));
    }
    if !repo.head_exists()? {
        return Err(VcsError::NoCommits(base.to_owned()));
    }
    let fork_point = fork_point(repo, base)?
        .ok_or_else(|| VcsError::InvalidRequest(format!("there is no branch named {base}")))?;
    let (commits, truncated) = commits_since(repo, &fork_point)?;
    if commits.is_empty() {
        return Err(VcsError::NoCommits(base.to_owned()));
    }
    Ok(PrContext {
        base: base.to_owned(),
        branch,
        commits,
        stat: stat_text(repo, &["diff", fork_point.as_str(), "HEAD"])?,
        truncated,
    })
}

/// The commit where HEAD left `base`. Measured against what was last fetched from `origin` when
/// that exists, because a local `main` that was never updated would count other people's
/// commits as this branch's. `None` when `base` is known neither way.
pub fn fork_point(repo: &Repo, base: &str) -> Result<Option<String>, VcsError> {
    let Some(base_ref) = base_ref(repo, base)? else {
        return Ok(None);
    };
    let output = repo
        .read(["merge-base", &base_ref, "HEAD"])
        .run_unchecked()?;
    match output.code {
        0 => Ok(Some(output.text()?)),
        1 => Err(VcsError::InvalidRequest(format!(
            "{base} and this branch have no history in common"
        ))),
        _ => Err(output.into_error().into()),
    }
}

/// Whether the branch has any commit that `base` lacks. When `base` cannot be found here the
/// answer is "yes", and whoever creates the pull request gets to judge.
pub fn has_commits_ahead(repo: &Repo, base: &str) -> Result<bool, VcsError> {
    if !repo.head_exists()? {
        return Ok(false);
    }
    let Some(fork_point) = fork_point(repo, base)? else {
        return Ok(true);
    };
    let range = format!("{fork_point}..HEAD");
    let output = repo.read(["rev-list", "--count", &range]).run()?;
    Ok(output.text()? != "0")
}

fn base_ref(repo: &Repo, base: &str) -> Result<Option<String>, VcsError> {
    for prefix in [ORIGIN_REFS, LOCAL_REFS] {
        let candidate = format!("{prefix}{base}");
        if commit_exists(repo, &candidate)? {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

fn commit_exists(repo: &Repo, full_ref: &str) -> Result<bool, VcsError> {
    let spec = format!("{full_ref}^{{commit}}");
    let output = repo
        .read(["rev-parse", "--verify", "--quiet", &spec])
        .run_unchecked()?;
    match output.code {
        0 => Ok(true),
        1 => Ok(false),
        _ => Err(output.into_error().into()),
    }
}

fn commits_since(repo: &Repo, fork_point: &str) -> Result<(Vec<PrCommit>, bool), VcsError> {
    let range = format!("{fork_point}..HEAD");
    let asked = (PR_COMMIT_LIMIT + 1).to_string();
    let output = repo
        .read([
            "log",
            "--reverse",
            "-n",
            &asked,
            "-z",
            "--no-show-signature",
            "--format=%s%x00%b",
            &range,
        ])
        .run()?;
    let mut commits = parse_commits(&output.stdout)?;
    let truncated = commits.len() > PR_COMMIT_LIMIT;
    if truncated {
        commits.drain(..commits.len() - PR_COMMIT_LIMIT);
    }
    Ok((commits, truncated))
}

/// Every commit is a subject and a body, each ended by a NUL, so nothing a message contains can be
/// mistaken for a separator.
fn parse_commits(stdout: &[u8]) -> Result<Vec<PrCommit>, VcsError> {
    let ended = stdout.strip_suffix(&[0]).unwrap_or(stdout);
    if ended.is_empty() {
        return Ok(Vec::new());
    }
    let fields: Vec<&[u8]> = ended.split(|byte| *byte == 0).collect();
    if !fields.len().is_multiple_of(2) {
        return Err(VcsError::output("log", "a commit lacked its body field"));
    }
    Ok(fields
        .chunks_exact(2)
        .map(|pair| PrCommit {
            subject: lossy(pair[0]).trim().to_owned(),
            body: cap_chars(lossy(pair[1]).trim(), COMMIT_BODY_LIMIT).to_owned(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commits_are_read_as_subject_and_body_pairs() {
        let stdout = b"feat: one\0First paragraph.\n\nSecond.\n\0fix: two\0\n\0";
        let commits = parse_commits(stdout).expect("parses");
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "feat: one");
        assert_eq!(commits[0].body, "First paragraph.\n\nSecond.");
        assert_eq!(commits[1].subject, "fix: two");
        assert_eq!(commits[1].body, "");
    }

    #[test]
    fn no_output_is_no_commits_and_an_empty_message_is_still_one_commit() {
        assert!(parse_commits(b"").expect("parses").is_empty());
        let empty_message = parse_commits(b"\0\n\0").expect("parses");
        assert_eq!(empty_message.len(), 1);
        assert_eq!(empty_message[0].subject, "");
    }

    #[test]
    fn a_record_without_its_body_field_is_malformed() {
        assert!(parse_commits(b"feat: one\0body\0lonely subject\0").is_err());
    }

    #[test]
    fn a_long_body_is_cut_to_the_limit() {
        let mut stdout = b"s\0".to_vec();
        stdout.extend("é".repeat(COMMIT_BODY_LIMIT + 50).bytes());
        stdout.push(0);
        let commits = parse_commits(&stdout).expect("parses");
        assert_eq!(commits[0].body.chars().count(), COMMIT_BODY_LIMIT);
    }
}
