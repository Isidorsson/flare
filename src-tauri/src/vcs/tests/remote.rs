use super::support::{error_code, run_git, Fixture, BRANCH};

fn remote_head(fixture: &Fixture) -> String {
    let remote = fixture.remote.as_ref().expect("a remote");
    run_git(remote, &["rev-parse", BRANCH])
}

#[test]
fn the_first_push_sets_the_upstream_and_publishes_the_branch() {
    let fixture = Fixture::with_remote();
    let before = fixture.status();
    assert_eq!(before.upstream, None);

    let status = fixture.push().expect("push");
    assert_eq!(status.upstream.as_deref(), Some("origin/main"));
    assert_eq!((status.ahead, status.behind), (0, 0));
    assert_eq!(remote_head(&fixture), fixture.head());
    assert_eq!(fixture.git(&["config", "branch.main.remote"]), "origin");
}

#[test]
fn a_later_push_sends_new_commits_to_the_upstream() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("first push");
    fixture.write("a.txt", "a2\n");
    fixture.commit_all("second");
    assert_eq!(fixture.status().ahead, 1);

    let status = fixture.push().expect("second push");
    assert_eq!(status.ahead, 0);
    assert_eq!(remote_head(&fixture), fixture.head());
}

#[test]
fn a_new_branch_is_pushed_under_its_own_name_and_tracks_it() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("publish main");
    fixture.create_branch("feature").expect("create");
    fixture.write("f.txt", "f\n");
    fixture.commit_all("feature work");

    let status = fixture.push().expect("push the new branch");
    assert_eq!(status.upstream.as_deref(), Some("origin/feature"));
    let remote = fixture.remote.as_ref().expect("a remote");
    assert_eq!(run_git(remote, &["rev-parse", "feature"]), fixture.head());
}

#[test]
fn fetch_reports_how_far_behind_the_branch_is() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("push");
    let teammate = fixture.teammate();
    teammate.write("theirs.txt", "t\n");
    teammate.commit_all("their commit");
    teammate.git(&["push", "--quiet"]);

    assert_eq!(fixture.status().behind, 0);
    let status = fixture.fetch().expect("fetch");
    assert_eq!(status.behind, 1);
    assert_eq!(status.ahead, 0);
    assert!(!fixture.exists("theirs.txt"), "fetch does not touch files");
}

#[test]
fn pull_fast_forwards_to_the_upstream() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("push");
    let teammate = fixture.teammate();
    teammate.write("theirs.txt", "t\n");
    teammate.commit_all("their commit");
    teammate.git(&["push", "--quiet"]);

    let status = fixture.pull().expect("pull");
    assert_eq!((status.ahead, status.behind), (0, 0));
    assert_eq!(fixture.read("theirs.txt"), "t\n");
    assert_eq!(fixture.head(), teammate.head());
}

#[test]
fn pull_refuses_to_merge_when_the_branches_have_diverged() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("push");
    let teammate = fixture.teammate();
    teammate.write("theirs.txt", "t\n");
    teammate.commit_all("their commit");
    teammate.git(&["push", "--quiet"]);
    fixture.write("mine.txt", "m\n");
    fixture.commit_all("my commit");
    let before = fixture.head();

    let error = fixture.pull().expect_err("cannot fast-forward");
    assert_eq!(error.code(), "git");
    assert_eq!(fixture.head(), before);
    assert!(!fixture.exists("theirs.txt"));
}

#[test]
fn a_rejected_push_reports_git_s_reason_and_changes_nothing() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("push");
    let teammate = fixture.teammate();
    teammate.write("theirs.txt", "t\n");
    teammate.commit_all("their commit");
    teammate.git(&["push", "--quiet"]);
    let remote_before = remote_head(&fixture);
    fixture.write("mine.txt", "m\n");
    fixture.commit_all("my commit");

    assert_eq!(error_code(fixture.push()), "git");
    assert_eq!(remote_head(&fixture), remote_before);
}

#[test]
fn pull_needs_an_upstream() {
    let fixture = Fixture::with_remote();
    assert_eq!(error_code(fixture.pull()), "no_upstream");
}

#[test]
fn a_detached_head_cannot_be_pushed_or_pulled() {
    let fixture = Fixture::with_remote();
    fixture.git(&["checkout", "--quiet", "--detach"]);
    assert_eq!(error_code(fixture.push()), "detached_head");
    assert_eq!(error_code(fixture.pull()), "detached_head");
}

#[test]
fn without_a_remote_fetch_and_push_say_so() {
    let fixture = Fixture::repo();
    assert_eq!(error_code(fixture.fetch()), "no_remote");
    assert_eq!(error_code(fixture.push()), "no_remote");
}

#[test]
fn an_unreachable_remote_fails_with_git_s_message_instead_of_hanging() {
    let fixture = Fixture::repo();
    let missing = fixture.path("no-such-remote");
    fixture.git(&["remote", "add", "origin", &missing.to_string_lossy()]);
    assert_eq!(error_code(fixture.fetch()), "git");
    assert_eq!(error_code(fixture.push()), "git");
}

#[test]
fn a_remote_branch_is_listed_and_switching_to_it_creates_a_tracking_branch() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("push");
    let teammate = fixture.teammate();
    teammate.git(&["switch", "--quiet", "-c", "feature"]);
    teammate.write("feature.txt", "f\n");
    teammate.commit_all("feature work");
    teammate.git(&["push", "--quiet", "-u", "origin", "feature"]);
    fixture.fetch().expect("fetch");

    let branches = fixture.branches();
    let remote_names: Vec<&str> = branches
        .iter()
        .filter(|branch| branch.remote)
        .map(|branch| branch.name.as_str())
        .collect();
    assert_eq!(remote_names, ["origin/feature", "origin/main"]);
    let local = branches
        .iter()
        .find(|branch| branch.name == BRANCH)
        .expect("main");
    assert_eq!(local.upstream.as_deref(), Some("origin/main"));

    let status = fixture.switch("origin/feature").expect("switch");
    assert_eq!(status.branch.as_deref(), Some("feature"));
    assert_eq!(status.upstream.as_deref(), Some("origin/feature"));
    assert_eq!(fixture.read("feature.txt"), "f\n");
}

#[test]
fn switching_to_a_remote_branch_that_already_has_a_local_one_uses_it() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("push");
    let status = fixture
        .switch("origin/main")
        .expect("switch to origin/main");
    assert_eq!(status.branch.as_deref(), Some(BRANCH));
}

#[test]
fn deleted_remote_branches_disappear_from_the_list_after_a_fetch() {
    let fixture = Fixture::with_remote();
    fixture.push().expect("push");
    let teammate = fixture.teammate();
    teammate.git(&["push", "--quiet", "origin", "HEAD:refs/heads/short-lived"]);
    fixture.fetch().expect("fetch");
    assert!(fixture
        .branches()
        .iter()
        .any(|branch| branch.name == "origin/short-lived"));

    teammate.git(&["push", "--quiet", "origin", "--delete", "short-lived"]);
    fixture.fetch().expect("fetch again");
    assert!(!fixture
        .branches()
        .iter()
        .any(|branch| branch.name == "origin/short-lived"));
}
