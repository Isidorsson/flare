//! The GitHub CLI as the pull request commands use it: how its failures become Flare's errors, and
//! how its output is read. Nothing here but `access` and `run` starts a process, so the rest is
//! checked against recorded output.

use std::time::Duration;

use serde::Deserialize;

use crate::git_cli::{Git, GitError, Invocation, Output};

use super::error::VcsError;
use super::model::{PrState, PullRequest};

/// The fields of a pull request that `PullRequest` carries, in `gh pr view --json` spelling.
pub const PR_FIELDS: &str = "number,url,title,state,isDraft,baseRefName";
/// Questions to GitHub that should be answered at once. Creating a pull request takes longer and
/// uses `remote::NETWORK_TIMEOUT`.
pub const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// `gh help exit-codes`: a command that needs a login exits with 4.
const AUTH_REQUIRED_EXIT: i32 = 4;
const NO_PULL_REQUEST: &str = "no pull requests found";
const AUTH_FAILURES: [&str; 6] = [
    "gh auth login",
    "gh_token",
    "http 401",
    "bad credentials",
    "not logged in",
    "authentication failed",
];

/// Whether `gh` can be used from here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Missing,
    SignedOut,
    SignedIn,
}

/// Asks `gh auth status`, scoped to the remote's host when that is known: a stale login on some
/// other host would otherwise make the exit status say "signed out".
pub fn access(gh: &Git, host: Option<&str>) -> Result<Access, VcsError> {
    let mut args = vec!["auth", "status"];
    if let Some(host) = host {
        args.extend(["--hostname", host]);
    }
    match gh.command(args).timeout(READ_TIMEOUT).run_unchecked() {
        Err(GitError::Missing(_)) => Ok(Access::Missing),
        Err(other) => Err(gh_error(other)),
        Ok(output) if output.code == 0 => Ok(Access::SignedIn),
        Ok(_) => Ok(Access::SignedOut),
    }
}

/// Runs `gh` and fails unless it exits with status 0.
pub fn run(invocation: Invocation<'_>) -> Result<Output, VcsError> {
    let output = run_unchecked(invocation)?;
    if output.code == 0 {
        Ok(output)
    } else {
        Err(failure(output))
    }
}

/// For callers that read the exit status; a refusal they do not recognise goes through `failure`.
pub fn run_unchecked(invocation: Invocation<'_>) -> Result<Output, VcsError> {
    invocation.run_unchecked().map_err(gh_error)
}

pub fn failure(output: Output) -> VcsError {
    if needs_sign_in(output.code, &output.stderr) {
        return VcsError::GhUnauthenticated;
    }
    gh_error(output.into_error())
}

pub fn text(output: &Output) -> Result<String, VcsError> {
    output.text().map_err(gh_error)
}

fn gh_error(error: GitError) -> VcsError {
    match error {
        GitError::Missing(_) => VcsError::GhMissing,
        GitError::Failed { command, stderr } => VcsError::Gh { command, stderr },
        GitError::Timeout { command, seconds } => VcsError::Timeout {
            command: format!("gh {command}"),
            seconds,
        },
        GitError::Output { command, detail } => gh_output(&command, detail),
        other => VcsError::from(other),
    }
}

pub fn gh_output(command: &str, detail: impl Into<String>) -> VcsError {
    VcsError::Output {
        command: format!("gh {command}"),
        detail: detail.into(),
    }
}

/// Whether a failed `gh` run was refused for want of a login, by its exit status or its message.
pub fn needs_sign_in(code: i32, stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    code == AUTH_REQUIRED_EXIT || AUTH_FAILURES.iter().any(|marker| lower.contains(marker))
}

/// `gh pr view` exits with 1 and this message when the branch has no pull request, which is an
/// answer rather than a failure.
pub fn is_no_pull_request(stderr: &str) -> bool {
    stderr.to_lowercase().contains(NO_PULL_REQUEST)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestJson {
    number: u64,
    url: String,
    title: String,
    state: String,
    is_draft: bool,
    base_ref_name: String,
}

pub fn parse_pull_request(json: &[u8]) -> Result<PullRequest, VcsError> {
    let raw: PullRequestJson = serde_json::from_slice(json)
        .map_err(|error| gh_output("pr view", format!("not a pull request: {error}")))?;
    let state = match raw.state.to_ascii_lowercase().as_str() {
        "open" => PrState::Open,
        "closed" => PrState::Closed,
        "merged" => PrState::Merged,
        other => return Err(gh_output("pr view", format!("unknown state {other:?}"))),
    };
    Ok(PullRequest {
        number: raw.number,
        url: raw.url,
        title: raw.title,
        state,
        is_draft: raw.is_draft,
        base: raw.base_ref_name,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoJson {
    default_branch_ref: Option<BranchRefJson>,
}

#[derive(Deserialize)]
struct BranchRefJson {
    name: String,
}

/// `None` for a repository that has no branch yet.
pub fn parse_default_branch(json: &[u8]) -> Result<Option<String>, VcsError> {
    let raw: RepoJson = serde_json::from_slice(json)
        .map_err(|error| gh_output("repo view", format!("not a repository: {error}")))?;
    Ok(raw.default_branch_ref.map(|branch| branch.name))
}

/// The pull request address `gh pr create` prints, which is its last line of standard output
/// (older versions put progress text before it).
pub fn extract_pr_url(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| is_pull_request_url(line))
        .map(str::to_owned)
}

fn is_pull_request_url(text: &str) -> bool {
    let Some(rest) = text
        .strip_prefix("https://")
        .or_else(|| text.strip_prefix("http://"))
    else {
        return false;
    };
    let parts: Vec<&str> = rest.split('/').collect();
    match parts.as_slice() {
        [host, owner, repo, "pull", number] => {
            [host, owner, repo].iter().all(|part| !part.is_empty())
                && !number.is_empty()
                && number.bytes().all(|byte| byte.is_ascii_digit())
        }
        _ => false,
    }
}

/// The host a remote URL points at (`github.com`), for any of git's spellings: `https://`,
/// `ssh://`, or the `user@host:owner/repo` shorthand. A local path has none.
pub fn remote_host(url: &str) -> Option<String> {
    let url = url.trim();
    let authority = match url.split_once("://") {
        Some(("file", _)) => return None,
        Some((_, rest)) => rest.split('/').next()?,
        None => {
            let (before_colon, _) = url.split_once(':')?;
            if before_colon.contains(['/', '\\']) {
                return None;
            }
            before_colon
        }
    };
    let host_and_port = authority.rsplit('@').next()?;
    let host = host_and_port.split(':').next()?;
    let is_host = host.len() > 1
        && host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-');
    is_host.then(|| host.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const OPEN_PR: &str = r#"{"baseRefName":"main","isDraft":false,"number":12,"state":"OPEN","title":"feat: login","url":"https://github.com/o/r/pull/12"}"#;

    #[test]
    fn a_pull_request_is_read_from_gh_json() {
        let pr = parse_pull_request(OPEN_PR.as_bytes()).expect("parses");
        assert_eq!(pr.number, 12);
        assert_eq!(pr.url, "https://github.com/o/r/pull/12");
        assert_eq!(pr.title, "feat: login");
        assert_eq!(pr.state, PrState::Open);
        assert!(!pr.is_draft);
        assert_eq!(pr.base, "main");
    }

    #[test]
    fn states_map_to_lower_case_names() {
        for (gh, expected) in [
            ("OPEN", PrState::Open),
            ("CLOSED", PrState::Closed),
            ("MERGED", PrState::Merged),
        ] {
            let json = OPEN_PR.replace("OPEN", gh);
            assert_eq!(
                parse_pull_request(json.as_bytes()).expect("parses").state,
                expected
            );
        }
    }

    #[test]
    fn an_unknown_state_or_a_missing_field_is_an_error() {
        let unknown = OPEN_PR.replace("OPEN", "DRAFTING");
        let error = parse_pull_request(unknown.as_bytes()).expect_err("unknown state");
        assert_eq!(error.code(), "output");
        let missing = r#"{"number":1}"#;
        assert!(parse_pull_request(missing.as_bytes()).is_err());
        assert!(parse_pull_request(b"not json").is_err());
    }

    #[test]
    fn the_default_branch_is_read_from_the_repository_json() {
        let json = br#"{"defaultBranchRef":{"name":"trunk"}}"#;
        assert_eq!(
            parse_default_branch(json).expect("parses").as_deref(),
            Some("trunk")
        );
        let empty = br#"{"defaultBranchRef":null}"#;
        assert_eq!(parse_default_branch(empty).expect("parses"), None);
        assert!(parse_default_branch(b"{}").expect("parses").is_none());
    }

    #[test]
    fn a_branch_without_a_pull_request_is_recognised_by_gh_message() {
        assert!(is_no_pull_request(
            "no pull requests found for branch \"feat/login\""
        ));
        assert!(is_no_pull_request("No Pull Requests Found for branch x"));
        assert!(!is_no_pull_request(
            "GraphQL: Could not resolve to a Repository"
        ));
    }

    #[test]
    fn the_pull_request_url_is_found_among_progress_text() {
        let stdout = "\nCreating pull request for feat/login into main in o/r\n\nhttps://github.com/o/r/pull/34\n";
        assert_eq!(
            extract_pr_url(stdout).as_deref(),
            Some("https://github.com/o/r/pull/34")
        );
        let enterprise = "https://git.example.com/team/app/pull/5\r\n";
        assert_eq!(
            extract_pr_url(enterprise).as_deref(),
            Some("https://git.example.com/team/app/pull/5")
        );
    }

    #[test]
    fn text_that_is_not_a_pull_request_address_is_not_taken_for_one() {
        assert_eq!(extract_pr_url(""), None);
        assert_eq!(extract_pr_url("https://github.com/o/r\n"), None);
        assert_eq!(extract_pr_url("https://github.com/o/r/pull/x\n"), None);
        assert_eq!(extract_pr_url("https://github.com/o/r/issues/4\n"), None);
        assert_eq!(
            extract_pr_url("https://github.com/o/r/pull/4/files\n"),
            None
        );
    }

    #[test]
    fn sign_in_problems_are_told_apart_from_other_failures() {
        assert!(needs_sign_in(4, ""));
        assert!(needs_sign_in(
            1,
            "To get started with GitHub CLI, please run:  gh auth login"
        ));
        assert!(needs_sign_in(
            1,
            "HTTP 401: Bad credentials (https://api.github.com/graphql)"
        ));
        assert!(needs_sign_in(
            1,
            "gh: To use GitHub CLI in automation, set the GH_TOKEN environment variable."
        ));
        assert!(!needs_sign_in(
            1,
            "a pull request for branch \"x\" already exists"
        ));
        assert!(!needs_sign_in(1, "HTTP 422: Validation Failed"));
    }

    #[test]
    fn gh_errors_map_to_flare_codes() {
        let missing = gh_error(GitError::Missing("gh".to_owned()));
        assert_eq!(missing.code(), "gh_missing");
        let failed = gh_error(GitError::Failed {
            command: "pr create".to_owned(),
            stderr: "already exists".to_owned(),
        });
        assert_eq!(failed.code(), "gh");
        assert_eq!(failed.to_string(), "gh pr create failed: already exists");
        let timeout = gh_error(GitError::Timeout {
            command: "pr create".to_owned(),
            seconds: 600,
        });
        assert_eq!(timeout.code(), "timeout");
        assert_eq!(
            timeout.to_string(),
            "gh pr create did not finish in 600 seconds and was stopped"
        );
    }

    #[test]
    fn hosts_are_read_from_every_remote_spelling() {
        let cases = [
            ("https://github.com/o/r.git", Some("github.com")),
            ("https://user:token@github.com/o/r", Some("github.com")),
            ("git@github.com:o/r.git", Some("github.com")),
            (
                "ssh://git@git.example.com:2222/team/app.git",
                Some("git.example.com"),
            ),
            (
                "https://git.example.com:8443/team/app",
                Some("git.example.com"),
            ),
            ("  https://github.com/o/r\n", Some("github.com")),
            ("file:///srv/git/repo.git", None),
            ("/srv/git/repo.git", None),
            ("C:\\work\\repo.git", None),
            ("C:/work/repo.git", None),
            ("../sibling", None),
            ("", None),
        ];
        for (url, expected) in cases {
            assert_eq!(remote_host(url).as_deref(), expected, "{url:?}");
        }
    }
}
