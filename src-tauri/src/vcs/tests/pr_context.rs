use crate::vcs::pr_context::PR_COMMIT_LIMIT;

use super::support::{error_code, Fixture};

/// A repository on `main` that has been pushed, then on `feature` with nothing yet.
fn on_feature() -> Fixture {
    let fixture = Fixture::with_remote();
    fixture.push().expect("publish main");
    fixture.create_branch("feature").expect("create feature");
    fixture
}

#[test]
fn the_commits_and_changes_since_the_base_are_described_oldest_first() {
    let fixture = on_feature();
    fixture.write("login.txt", "login\n");
    fixture.commit_all("feat(login): add the form");
    fixture.write("a.txt", "a2\n");
    fixture.stage(&["a.txt"]).expect("stage");
    fixture.git(&[
        "commit",
        "--quiet",
        "-m",
        "fix: keep a.txt current",
        "-m",
        "It was stale.\n\nSo refresh it.",
    ]);

    let context = fixture.pr_context("main").expect("context");
    assert_eq!(context.base, "main");
    assert_eq!(context.branch, "feature");
    assert!(!context.truncated);
    let subjects: Vec<&str> = context
        .commits
        .iter()
        .map(|commit| commit.subject.as_str())
        .collect();
    assert_eq!(
        subjects,
        ["feat(login): add the form", "fix: keep a.txt current"]
    );
    assert_eq!(context.commits[0].body, "");
    assert_eq!(context.commits[1].body, "It was stale.\n\nSo refresh it.");
    assert!(context.stat.contains("login.txt"));
    assert!(context.stat.contains("a.txt"));
    assert!(!context.stat.contains("b.txt"));
}

#[test]
fn changes_already_on_the_base_are_not_part_of_the_pull_request() {
    let fixture = on_feature();
    fixture.write("only-on-feature.txt", "x\n");
    fixture.commit_all("feature work");
    let context = fixture.pr_context("main").expect("context");
    assert_eq!(context.commits.len(), 1);
    assert!(!context.stat.contains("keep.txt"));
}

#[test]
fn the_fetched_base_is_used_when_there_is_one_so_unpushed_base_commits_count() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("publish main");
    fixture.write("unpushed.txt", "u\n");
    fixture.commit_all("local-only commit on main");
    fixture.create_branch("feature").expect("create feature");
    fixture.write("f.txt", "f\n");
    fixture.commit_all("feature work");

    let context = fixture.pr_context("main").expect("context");
    let subjects: Vec<&str> = context
        .commits
        .iter()
        .map(|commit| commit.subject.as_str())
        .collect();
    assert_eq!(subjects, ["local-only commit on main", "feature work"]);
    assert!(context.stat.contains("unpushed.txt"));
}

#[test]
fn without_a_fetched_copy_the_local_base_is_used() {
    let fixture = Fixture::repo();
    fixture.create_branch("feature").expect("create feature");
    fixture.write("f.txt", "f\n");
    fixture.commit_all("feature work");
    let context = fixture.pr_context("main").expect("context");
    assert_eq!(context.commits.len(), 1);
    assert_eq!(context.commits[0].subject, "feature work");
}

#[test]
fn a_branch_with_nothing_ahead_of_the_base_has_no_commits_to_describe() {
    let fixture = on_feature();
    assert_eq!(error_code(fixture.pr_context("main")), "no_commits");
}

#[test]
fn a_repository_with_no_commits_has_none_to_describe() {
    let fixture = Fixture::unborn();
    fixture.git(&["symbolic-ref", "HEAD", "refs/heads/feature"]);
    assert_eq!(error_code(fixture.pr_context("main")), "no_commits");
}

#[test]
fn the_base_branch_itself_cannot_be_described() {
    let fixture = on_feature();
    fixture.switch("main").expect("switch");
    assert_eq!(error_code(fixture.pr_context("main")), "on_base_branch");
}

#[test]
fn a_detached_head_cannot_be_described() {
    let fixture = on_feature();
    fixture.git(&["checkout", "--quiet", "--detach"]);
    assert_eq!(error_code(fixture.pr_context("main")), "detached_head");
}

#[test]
fn a_base_that_does_not_exist_or_is_not_a_branch_name_is_refused() {
    let fixture = on_feature();
    fixture.write("f.txt", "f\n");
    fixture.commit_all("feature work");
    assert_eq!(error_code(fixture.pr_context("nope")), "invalid_request");
    assert_eq!(error_code(fixture.pr_context("a..b")), "invalid_request");
    assert_eq!(
        error_code(fixture.pr_context("--output=x")),
        "invalid_request"
    );
    assert_eq!(error_code(fixture.pr_context("")), "invalid_request");
}

#[test]
fn a_branch_with_no_history_in_common_with_the_base_is_refused() {
    let fixture = Fixture::repo();
    fixture.git(&["checkout", "--quiet", "--orphan", "unrelated"]);
    fixture.write("other.txt", "o\n");
    fixture.commit_all("unrelated root");
    assert_eq!(error_code(fixture.pr_context("main")), "invalid_request");
}

#[test]
fn a_long_branch_keeps_its_newest_commits_oldest_first_and_says_it_was_cut() {
    let fixture = on_feature();
    let total = PR_COMMIT_LIMIT + 5;
    let subjects: Vec<String> = (1..=total).map(|n| format!("commit {n:03}")).collect();
    fixture.commit_empty(&subjects);

    let context = fixture.pr_context("main").expect("context");
    assert!(context.truncated);
    assert_eq!(context.commits.len(), PR_COMMIT_LIMIT);
    assert_eq!(context.commits[0].subject, "commit 006");
    assert_eq!(
        context.commits[PR_COMMIT_LIMIT - 1].subject,
        format!("commit {total:03}")
    );
}

#[test]
fn exactly_the_limit_is_not_a_cut() {
    let fixture = on_feature();
    let subjects: Vec<String> = (1..=PR_COMMIT_LIMIT)
        .map(|n| format!("commit {n:03}"))
        .collect();
    fixture.commit_empty(&subjects);
    let context = fixture.pr_context("main").expect("context");
    assert!(!context.truncated);
    assert_eq!(context.commits.len(), PR_COMMIT_LIMIT);
}

#[test]
fn messages_in_any_script_survive_intact() {
    let fixture = on_feature();
    fixture.commit_with_body(
        "fix: 日本語のテスト é",
        "Zażółć gęślą jaźń.\n\n- one\n- two",
    );
    let context = fixture.pr_context("main").expect("context");
    assert_eq!(context.commits[0].subject, "fix: 日本語のテスト é");
    assert_eq!(
        context.commits[0].body,
        "Zażółć gęślą jaźń.\n\n- one\n- two"
    );
}

#[test]
fn a_folder_outside_a_repository_is_an_error() {
    let fixture = Fixture::plain();
    assert_eq!(error_code(fixture.pr_context("main")), "not_a_repository");
}
