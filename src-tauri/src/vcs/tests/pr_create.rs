use std::fs;

use crate::vcs::model::PrState;

use super::fake_gh::{missing_gh, FakeGh};
use super::support::{error_code, run_git, Fixture};

const CREATED: &str = "Creating pull request for feature into main in octo/app\n\nhttps://github.com/octo/app/pull/34\n";
const VIEWED: &str = r#"{"baseRefName":"main","isDraft":false,"number":34,"state":"OPEN","title":"feat: add it","url":"https://github.com/octo/app/pull/34"}"#;

/// A pushed `main`, then `feature` with one commit that has not been pushed.
fn feature_with_a_commit() -> Fixture {
    let fixture = Fixture::with_remote();
    fixture.push().expect("publish main");
    fixture.create_branch("feature").expect("create feature");
    fixture.write("f.txt", "f\n");
    fixture.commit_all("feat: add it");
    fixture
}

fn answering() -> FakeGh {
    let gh = FakeGh::signed_in();
    gh.set("create.out", CREATED);
    gh.set("view.json", VIEWED);
    gh
}

/// Makes every push from the fixture leave a line in `.git/pushes`.
fn watch_pushes(fixture: &Fixture) {
    let hook = fixture.path(".git/hooks/pre-push");
    fs::create_dir_all(hook.parent().expect("hooks dir")).expect("create hooks dir");
    fs::write(
        &hook,
        "#!/bin/sh
echo pushed >> .git/pushes
",
    )
    .expect("write hook");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).expect("make executable");
    }
}

fn pushes(fixture: &Fixture) -> usize {
    fs::read_to_string(fixture.path(".git/pushes")).map_or(0, |log| log.lines().count())
}

fn remote_has(fixture: &Fixture, branch: &str) -> bool {
    let remote = fixture.remote.as_ref().expect("a remote");
    !run_git(remote, &["branch", "--list", branch]).is_empty()
}

#[test]
fn a_new_branch_is_pushed_then_the_pull_request_is_created_and_read_back() {
    let fixture = feature_with_a_commit();
    watch_pushes(&fixture);
    let gh = answering();
    let request = fixture.pr_request("  feat: add it  ", "main");

    let created = fixture
        .create_pr(&gh.runner(&fixture.root), &request)
        .expect("created");

    assert_eq!(created.pr.number, 34);
    assert_eq!(created.pr.state, PrState::Open);
    assert_eq!(created.pr.url, "https://github.com/octo/app/pull/34");
    assert_eq!(created.status.upstream.as_deref(), Some("origin/feature"));
    assert_eq!(created.status.ahead, 0);
    assert!(
        remote_has(&fixture, "feature"),
        "the branch was pushed first"
    );
    assert_eq!(pushes(&fixture), 1);

    let calls = gh.calls();
    assert_eq!(calls.len(), 3, "{calls:?}");
    assert_eq!(calls[0][..2], ["auth", "status"]);
    assert_eq!(
        calls[1],
        [
            "pr",
            "create",
            "--title",
            "feat: add it",
            "--body-file",
            "-",
            "--base",
            "main",
            "--head",
            "feature"
        ]
    );
    assert_eq!(
        calls[2],
        [
            "pr",
            "view",
            "https://github.com/octo/app/pull/34",
            "--json",
            "number,url,title,state,isDraft,baseRefName"
        ]
    );
}

#[test]
fn the_body_goes_in_on_standard_input_whatever_it_contains() {
    let fixture = feature_with_a_commit();
    let gh = answering();
    let mut request = fixture.pr_request("feat: add it", "main");
    request.body =
        "## Summary\n- \"quoted\" and 'single' and $HOME and `ticks`\n\n日本語 é\n".to_owned();

    fixture
        .create_pr(&gh.runner(&fixture.root), &request)
        .expect("created");
    assert_eq!(gh.create_stdin(), request.body);
}

#[test]
fn a_draft_is_created_with_the_draft_flag() {
    let fixture = feature_with_a_commit();
    let gh = answering();
    let mut request = fixture.pr_request("feat: add it", "main");
    request.draft = true;
    fixture
        .create_pr(&gh.runner(&fixture.root), &request)
        .expect("created");
    let create = &gh.calls()[1];
    assert_eq!(create.last().map(String::as_str), Some("--draft"));
}

#[test]
fn a_pushed_branch_that_is_ahead_is_pushed_again_first() {
    let fixture = feature_with_a_commit();
    fixture.push().expect("publish feature");
    fixture.write("g.txt", "g\n");
    fixture.commit_all("one more");
    assert_eq!(fixture.status().ahead, 1);
    watch_pushes(&fixture);

    let gh = answering();
    let created = fixture
        .create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"))
        .expect("created");
    assert_eq!(created.status.ahead, 0);
    assert_eq!(pushes(&fixture), 1);
    let remote = fixture.remote.as_ref().expect("a remote");
    assert_eq!(run_git(remote, &["rev-parse", "feature"]), fixture.head());
}

#[test]
fn a_pushed_branch_that_is_up_to_date_is_not_pushed_again() {
    let fixture = feature_with_a_commit();
    fixture.push().expect("publish feature");
    watch_pushes(&fixture);

    let gh = answering();
    fixture
        .create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"))
        .expect("created");
    assert_eq!(pushes(&fixture), 0);
}

#[test]
fn an_empty_title_is_refused_before_anything_happens() {
    let fixture = feature_with_a_commit();
    let gh = answering();
    for title in ["", "   \n"] {
        let request = fixture.pr_request(title, "main");
        let result = fixture.create_pr(&gh.runner(&fixture.root), &request);
        assert_eq!(error_code(result), "invalid_request");
    }
    assert!(gh.calls().is_empty());
    assert!(!remote_has(&fixture, "feature"));
}

#[test]
fn a_detached_head_is_refused() {
    let fixture = feature_with_a_commit();
    fixture.git(&["checkout", "--quiet", "--detach"]);
    let gh = answering();
    let result = fixture.create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"));
    assert_eq!(error_code(result), "detached_head");
    assert!(gh.calls().is_empty());
}

#[test]
fn creating_from_the_base_branch_itself_is_refused() {
    let fixture = feature_with_a_commit();
    fixture.switch("main").expect("switch");
    let gh = answering();
    let result = fixture.create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"));
    assert_eq!(error_code(result), "on_base_branch");
    assert!(gh.calls().is_empty());
}

#[test]
fn a_base_that_is_not_a_branch_name_is_refused() {
    let fixture = feature_with_a_commit();
    let gh = answering();
    for base in ["", "--head=evil", "a..b"] {
        let result = fixture.create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", base));
        assert_eq!(error_code(result), "invalid_request", "{base:?}");
    }
    assert!(gh.calls().is_empty());
}

#[test]
fn a_machine_without_gh_is_refused_before_the_branch_is_pushed() {
    let fixture = feature_with_a_commit();
    let result = fixture.create_pr(&missing_gh(&fixture.root), &fixture.pr_request("t", "main"));
    assert_eq!(error_code(result), "gh_missing");
    assert!(!remote_has(&fixture, "feature"));
}

#[test]
fn a_signed_out_gh_is_refused_before_the_branch_is_pushed() {
    let fixture = feature_with_a_commit();
    let gh = FakeGh::signed_out();
    let result = fixture.create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"));
    assert_eq!(error_code(result), "gh_unauthenticated");
    assert!(!remote_has(&fixture, "feature"));
    assert_eq!(gh.call_names(), ["auth status"]);
}

#[test]
fn a_branch_with_nothing_ahead_of_the_base_is_refused_before_the_push() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("publish main");
    fixture.create_branch("feature").expect("create feature");
    let gh = answering();
    let result = fixture.create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"));
    assert_eq!(error_code(result), "no_commits");
    assert!(!remote_has(&fixture, "feature"));
}

#[test]
fn a_repository_without_a_remote_cannot_push_and_says_so() {
    let fixture = Fixture::repo();
    fixture.create_branch("feature").expect("create feature");
    fixture.write("f.txt", "f\n");
    fixture.commit_all("feat: add it");
    let gh = answering();
    let result = fixture.create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"));
    assert_eq!(error_code(result), "no_remote");
    assert!(!gh.call_names().contains(&"pr create".to_owned()));
}

#[test]
fn a_gh_refusal_is_returned_with_its_message() {
    let fixture = feature_with_a_commit();
    let gh = answering();
    gh.set(
        "create.err",
        "a pull request for branch \"feature\" into branch \"main\" already exists:\nhttps://github.com/octo/app/pull/3",
    );
    let result = fixture.create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"));
    let error = result.expect_err("refused");
    assert_eq!(error.code(), "gh");
    assert!(error.to_string().contains("already exists"));
    assert!(error.to_string().starts_with("gh pr create failed:"));
}

#[test]
fn a_sign_in_failure_during_creation_is_reported_as_one() {
    let fixture = feature_with_a_commit();
    let gh = answering();
    gh.set(
        "create.err",
        "HTTP 401: Bad credentials (https://api.github.com/graphql)",
    );
    let result = fixture.create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"));
    assert_eq!(error_code(result), "gh_unauthenticated");
}

#[test]
fn gh_exit_status_for_a_missing_login_is_reported_as_a_sign_in_problem() {
    let fixture = feature_with_a_commit();
    let gh = answering();
    gh.set("create.err", "authentication required");
    gh.set("create.code", "4");
    let result = fixture.create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"));
    assert_eq!(error_code(result), "gh_unauthenticated");
}

#[test]
fn output_without_an_address_is_an_error_rather_than_a_guess() {
    let fixture = feature_with_a_commit();
    let gh = answering();
    gh.set("create.out", "Done!\n");
    let result = fixture.create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"));
    assert_eq!(error_code(result), "output");
}

#[test]
fn failing_to_read_back_a_created_pull_request_still_names_it() {
    let fixture = feature_with_a_commit();
    let gh = answering();
    gh.set("view.err", "temporarily unavailable");
    let error = fixture
        .create_pr(&gh.runner(&fixture.root), &fixture.pr_request("t", "main"))
        .expect_err("read back fails");
    assert_eq!(error.code(), "gh");
    assert!(error
        .to_string()
        .contains("created at https://github.com/octo/app/pull/34"));
}
