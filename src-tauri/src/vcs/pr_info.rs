//! What the pull request section needs first: whether `gh` works here, which branch pull requests
//! target by default, and whether the current branch already has one. A missing or signed-out `gh`
//! is reported in the fields; only a `gh` that fails for another reason is an error.

use crate::git_cli::Git;

use super::error::VcsError;
use super::gh::{
    access, failure, is_no_pull_request, parse_default_branch, parse_pull_request, remote_host,
    run_unchecked, Access, PR_FIELDS, READ_TIMEOUT,
};
use super::model::{PrInfo, PullRequest};
use super::repo::Repo;

const ORIGIN: &str = "origin";
const ORIGIN_PREFIX: &str = "origin/";

pub fn read(repo: &Repo, gh: &Git) -> Result<PrInfo, VcsError> {
    let remotes = repo.remotes()?;
    let reach = access_to_origin(repo, gh, &remotes)?;
    let can_ask = reach == Access::SignedIn && !remotes.is_empty();
    let from_gh = if can_ask { gh_default_base(gh)? } else { None };
    let default_base = match from_gh {
        Some(base) => Some(base),
        None => origin_head(repo)?,
    };
    Ok(PrInfo {
        gh_available: reach != Access::Missing,
        authenticated: reach == Access::SignedIn,
        default_base,
        current: if can_ask { current_pr(repo, gh)? } else { None },
    })
}

/// Whether `gh` is usable for the host `origin` lives on.
pub fn access_to_origin(repo: &Repo, gh: &Git, remotes: &[String]) -> Result<Access, VcsError> {
    access(gh, origin_host(repo, remotes)?.as_deref())
}

/// `gh pr view` with no argument finds the pull request whose head is the current branch.
pub fn current_pr(repo: &Repo, gh: &Git) -> Result<Option<PullRequest>, VcsError> {
    if repo.current_branch()?.is_none() || !repo.head_exists()? {
        return Ok(None);
    }
    let output = run_unchecked(
        gh.command(["pr", "view", "--json", PR_FIELDS])
            .timeout(READ_TIMEOUT),
    )?;
    match output.code {
        0 => parse_pull_request(&output.stdout).map(Some),
        _ if is_no_pull_request(&output.stderr) => Ok(None),
        _ => Err(failure(output)),
    }
}

fn origin_host(repo: &Repo, remotes: &[String]) -> Result<Option<String>, VcsError> {
    if !remotes.iter().any(|remote| remote == ORIGIN) {
        return Ok(None);
    }
    let url = repo.read(["remote", "get-url", ORIGIN]).run()?.text()?;
    Ok(remote_host(&url))
}

/// Without the repository's own answer (offline, or `gh` cannot tell which repository this is)
/// the default base falls back to what the last fetch recorded.
fn gh_default_base(gh: &Git) -> Result<Option<String>, VcsError> {
    let output = run_unchecked(
        gh.command(["repo", "view", "--json", "defaultBranchRef"])
            .timeout(READ_TIMEOUT),
    )?;
    if output.code != 0 {
        return Ok(None);
    }
    parse_default_branch(&output.stdout)
}

/// `origin/HEAD` is a symbolic ref to the remote's default branch, set by `git clone`.
fn origin_head(repo: &Repo) -> Result<Option<String>, VcsError> {
    let output = repo
        .read([
            "for-each-ref",
            "--format=%(symref:short)",
            "refs/remotes/origin/HEAD",
        ])
        .run()?;
    Ok(output
        .text()?
        .strip_prefix(ORIGIN_PREFIX)
        .filter(|base| !base.is_empty())
        .map(str::to_owned))
}
