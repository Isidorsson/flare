//! Creating a pull request. Everything that can be refused is refused first, before anything
//! leaves the machine; the caller then pushes the branch if it needs it (under the repository
//! lock) and finally asks `gh` to open the pull request.

use crate::git_cli::Git;

use super::branches::validate_name;
use super::error::VcsError;
use super::gh::{
    extract_pr_url, gh_output, parse_pull_request, run, text, Access, PR_FIELDS, READ_TIMEOUT,
};
use super::model::{PrCreateRequest, PullRequest};
use super::pr_context::has_commits_ahead;
use super::pr_info::access_to_origin;
use super::remote::NETWORK_TIMEOUT;
use super::repo::Repo;
use super::status;

pub struct Plan {
    pub branch: String,
    pub needs_push: bool,
}

/// Checks the request and the state it would act on. A branch that is ahead of its upstream, or
/// has none, has to be pushed before GitHub can see its commits.
pub fn prepare(repo: &Repo, gh: &Git, request: &PrCreateRequest) -> Result<Plan, VcsError> {
    if request.title.trim().is_empty() {
        return Err(VcsError::InvalidRequest(
            "the pull request title is empty".to_owned(),
        ));
    }
    validate_name(repo, &request.base)?;
    let branch = repo.require_branch()?;
    if branch == request.base {
        return Err(VcsError::OnBaseBranch(branch));
    }
    match access_to_origin(repo, gh, &repo.remotes()?)? {
        Access::Missing => return Err(VcsError::GhMissing),
        Access::SignedOut => return Err(VcsError::GhUnauthenticated),
        Access::SignedIn => {}
    }
    if !has_commits_ahead(repo, &request.base)? {
        return Err(VcsError::NoCommits(request.base.clone()));
    }
    let status = status::read(repo)?;
    Ok(Plan {
        needs_push: status.upstream.is_none() || status.ahead > 0,
        branch,
    })
}

/// Opens the pull request from an already pushed branch and reads it back, so the caller gets
/// the same `PullRequest` that `vcs_pr_info` would later report. The body goes in on standard
/// input, so its size and content need no quoting.
pub fn submit(gh: &Git, request: &PrCreateRequest, branch: &str) -> Result<PullRequest, VcsError> {
    let created = run(gh
        .command(create_args(request, branch))
        .stdin(request.body.clone().into_bytes())
        .timeout(NETWORK_TIMEOUT))?;
    let url = extract_pr_url(&text(&created)?)
        .ok_or_else(|| gh_output("pr create", "it printed no pull request address"))?;
    read_back(gh, &url).map_err(|error| VcsError::Gh {
        command: "pr create".to_owned(),
        stderr: format!(
            "the pull request was created at {url}, but reading it back failed: {error}"
        ),
    })
}

fn read_back(gh: &Git, url: &str) -> Result<PullRequest, VcsError> {
    let viewed = run(gh
        .command(["pr", "view", url, "--json", PR_FIELDS])
        .timeout(READ_TIMEOUT))?;
    parse_pull_request(&viewed.stdout)
}

fn create_args(request: &PrCreateRequest, branch: &str) -> Vec<String> {
    let mut args: Vec<String> = [
        "pr",
        "create",
        "--title",
        request.title.trim(),
        "--body-file",
        "-",
        "--base",
        request.base.as_str(),
        "--head",
        branch,
    ]
    .map(str::to_owned)
    .into();
    if request.draft {
        args.push("--draft".to_owned());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(draft: bool) -> PrCreateRequest {
        PrCreateRequest {
            root: String::new(),
            title: "  feat(login): add login  ".to_owned(),
            body: "## Summary\n- login".to_owned(),
            base: "main".to_owned(),
            draft,
        }
    }

    #[test]
    fn the_command_line_carries_title_base_and_head_with_the_body_on_stdin() {
        assert_eq!(
            create_args(&request(false), "feat/login"),
            [
                "pr",
                "create",
                "--title",
                "feat(login): add login",
                "--body-file",
                "-",
                "--base",
                "main",
                "--head",
                "feat/login"
            ]
        );
    }

    #[test]
    fn a_draft_adds_the_draft_flag() {
        let args = create_args(&request(true), "feat/login");
        assert_eq!(args.last().map(String::as_str), Some("--draft"));
    }

    #[test]
    fn a_title_that_looks_like_a_flag_stays_the_value_of_the_title_flag() {
        let mut flaggy = request(false);
        flaggy.title = "--draft".to_owned();
        let args = create_args(&flaggy, "b");
        assert_eq!(args[2], "--title");
        assert_eq!(args[3], "--draft");
    }
}
