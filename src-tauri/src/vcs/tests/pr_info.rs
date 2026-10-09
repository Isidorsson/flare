use crate::vcs::model::PrState;

use super::fake_gh::{missing_gh, FakeGh};
use super::support::Fixture;

const GITHUB_URL: &str = "https://github.com/octo/app.git";
const OPEN_PR: &str = r#"{"baseRefName":"main","isDraft":true,"number":12,"state":"OPEN","title":"feat: login","url":"https://github.com/octo/app/pull/12"}"#;
const NO_PR: &str = "no pull requests found for branch \"main\"";

/// `repo()` with `origin` pointing at GitHub's address (nothing is ever fetched from it).
fn github_repo() -> Fixture {
    let fixture = Fixture::repo();
    fixture.git(&["remote", "add", "origin", GITHUB_URL]);
    fixture
}

#[test]
fn a_machine_without_gh_is_reported_in_the_fields() {
    let fixture = github_repo();
    let info = fixture.pr_info(&missing_gh(&fixture.root)).expect("info");
    assert!(!info.gh_available);
    assert!(!info.authenticated);
    assert_eq!(info.current, None);
    assert_eq!(info.default_base, None);
}

#[test]
fn a_signed_out_gh_is_reported_and_nothing_else_is_asked() {
    let fixture = github_repo();
    let gh = FakeGh::signed_out();
    let info = fixture.pr_info(&gh.runner(&fixture.root)).expect("info");
    assert!(info.gh_available);
    assert!(!info.authenticated);
    assert_eq!(info.current, None);
    assert_eq!(gh.call_names(), ["auth status"]);
}

#[test]
fn the_sign_in_check_is_scoped_to_the_host_of_origin() {
    let fixture = github_repo();
    let gh = FakeGh::signed_in();
    gh.set("view.err", NO_PR);
    gh.set("repo.err", "no repo");
    fixture.pr_info(&gh.runner(&fixture.root)).expect("info");
    assert_eq!(
        gh.calls()[0],
        ["auth", "status", "--hostname", "github.com"]
    );
}

#[test]
fn a_remote_that_is_a_local_path_is_not_scoped_to_a_host() {
    let fixture = Fixture::with_remote();
    let gh = FakeGh::signed_in();
    gh.set("view.err", NO_PR);
    gh.set("repo.err", "no repo");
    fixture.pr_info(&gh.runner(&fixture.root)).expect("info");
    assert_eq!(gh.calls()[0], ["auth", "status"]);
}

#[test]
fn the_current_branchs_pull_request_is_returned_with_the_default_base_from_gh() {
    let fixture = github_repo();
    let gh = FakeGh::signed_in();
    gh.set("view.json", OPEN_PR);
    gh.set("repo.json", r#"{"defaultBranchRef":{"name":"trunk"}}"#);

    let info = fixture.pr_info(&gh.runner(&fixture.root)).expect("info");
    assert!(info.gh_available && info.authenticated);
    assert_eq!(info.default_base.as_deref(), Some("trunk"));
    let pr = info.current.expect("a pull request");
    assert_eq!(pr.number, 12);
    assert_eq!(pr.state, PrState::Open);
    assert!(pr.is_draft);
    assert_eq!(pr.base, "main");
    assert_eq!(pr.url, "https://github.com/octo/app/pull/12");

    let view = gh
        .calls()
        .into_iter()
        .find(|call| call[..2] == ["pr", "view"])
        .expect("asked for the pull request");
    assert_eq!(
        view,
        [
            "pr",
            "view",
            "--json",
            "number,url,title,state,isDraft,baseRefName"
        ]
    );
}

#[test]
fn gh_is_run_without_prompts_updates_or_colour() {
    let fixture = github_repo();
    let gh = FakeGh::signed_in();
    gh.set("view.err", NO_PR);
    gh.set("repo.err", "no repo");
    fixture.pr_info(&gh.runner(&fixture.root)).expect("info");
    assert_eq!(gh.env_line(), "1 1 1");
}

#[test]
fn a_branch_without_a_pull_request_has_none_and_that_is_not_an_error() {
    let fixture = github_repo();
    let gh = FakeGh::signed_in();
    gh.set("view.err", NO_PR);
    gh.set("repo.json", r#"{"defaultBranchRef":{"name":"main"}}"#);
    let info = fixture.pr_info(&gh.runner(&fixture.root)).expect("info");
    assert_eq!(info.current, None);
    assert_eq!(info.default_base.as_deref(), Some("main"));
}

#[test]
fn merged_and_closed_pull_requests_keep_their_state() {
    let fixture = github_repo();
    let gh = FakeGh::signed_in();
    gh.set("repo.err", "no repo");
    for (gh_state, expected) in [("MERGED", PrState::Merged), ("CLOSED", PrState::Closed)] {
        gh.set("view.json", &OPEN_PR.replace("OPEN", gh_state));
        let info = fixture.pr_info(&gh.runner(&fixture.root)).expect("info");
        assert_eq!(info.current.expect("a pull request").state, expected);
    }
}

#[test]
fn any_other_failure_to_read_the_pull_request_is_an_error_with_gh_message() {
    let fixture = github_repo();
    let gh = FakeGh::signed_in();
    gh.set("view.err", "GraphQL: Could not resolve to a Repository");
    gh.set("repo.err", "no repo");
    let error = fixture
        .pr_info(&gh.runner(&fixture.root))
        .expect_err("fails");
    assert_eq!(error.code(), "gh");
    assert!(error.to_string().contains("Could not resolve"));
}

#[test]
fn when_gh_cannot_tell_the_default_base_the_remote_head_is_used() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("push");
    fixture.git(&["remote", "set-head", "origin", "main"]);
    let gh = FakeGh::signed_in();
    gh.set("view.err", NO_PR);
    gh.set(
        "repo.err",
        "none of the git remotes point to a known GitHub host",
    );
    let info = fixture.pr_info(&gh.runner(&fixture.root)).expect("info");
    assert_eq!(info.default_base.as_deref(), Some("main"));
}

#[test]
fn the_remote_head_also_answers_when_gh_is_missing_or_signed_out() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("push");
    fixture.git(&[
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
    ]);
    let missing = fixture.pr_info(&missing_gh(&fixture.root)).expect("info");
    assert_eq!(missing.default_base.as_deref(), Some("main"));
    let gh = FakeGh::signed_out();
    let signed_out = fixture.pr_info(&gh.runner(&fixture.root)).expect("info");
    assert_eq!(signed_out.default_base.as_deref(), Some("main"));
}

#[test]
fn a_detached_head_has_no_current_pull_request_and_gh_is_not_asked() {
    let fixture = github_repo();
    fixture.git(&["checkout", "--quiet", "--detach"]);
    let gh = FakeGh::signed_in();
    gh.set("repo.err", "no repo");
    let info = fixture.pr_info(&gh.runner(&fixture.root)).expect("info");
    assert_eq!(info.current, None);
    assert!(!gh.call_names().contains(&"pr view".to_owned()));
}

#[test]
fn a_repository_without_a_remote_never_asks_gh_about_pull_requests() {
    let fixture = Fixture::repo();
    let gh = FakeGh::signed_in();
    let info = fixture.pr_info(&gh.runner(&fixture.root)).expect("info");
    assert!(info.authenticated);
    assert_eq!(info.current, None);
    assert_eq!(info.default_base, None);
    assert_eq!(gh.call_names(), ["auth status"]);
}
