use super::support::{error_code, Fixture, BRANCH};

fn names(fixture: &Fixture) -> Vec<String> {
    fixture
        .branches()
        .into_iter()
        .filter(|branch| !branch.remote)
        .map(|branch| branch.name)
        .collect()
}

#[test]
fn a_new_repository_lists_its_only_branch_as_current() {
    let fixture = Fixture::repo();
    let branches = fixture.branches();
    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0].name, BRANCH);
    assert!(branches[0].current);
    assert!(!branches[0].remote);
    assert_eq!(branches[0].upstream, None);
}

#[test]
fn a_repository_with_no_commits_still_lists_the_branch_it_is_on() {
    let fixture = Fixture::unborn();
    let branches = fixture.branches();
    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0].name, BRANCH);
    assert!(branches[0].current);
}

#[test]
fn creating_a_branch_switches_to_it_at_the_same_commit() {
    let fixture = Fixture::repo();
    let head = fixture.head();
    let status = fixture.create_branch("feature/login").expect("create");
    assert_eq!(status.branch.as_deref(), Some("feature/login"));
    assert_eq!(fixture.head(), head);
    let current: Vec<String> = fixture
        .branches()
        .into_iter()
        .filter(|branch| branch.current)
        .map(|branch| branch.name)
        .collect();
    assert_eq!(current, ["feature/login"]);
    assert_eq!(names(&fixture), ["feature/login", BRANCH]);
}

#[test]
fn creating_a_branch_carries_uncommitted_work_along() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "work in progress\n");
    let status = fixture.create_branch("wip").expect("create");
    assert_eq!(status.branch.as_deref(), Some("wip"));
    assert_eq!(fixture.read("a.txt"), "work in progress\n");
    assert_eq!(status.files.len(), 1);
}

#[test]
fn the_first_branch_of_a_repository_with_no_commits_can_be_renamed_by_creating_one() {
    let fixture = Fixture::unborn();
    let status = fixture.create_branch("develop").expect("create");
    assert_eq!(status.branch.as_deref(), Some("develop"));
    assert_eq!(names(&fixture), ["develop"]);
}

#[test]
fn creating_a_branch_that_exists_is_an_error() {
    let fixture = Fixture::repo();
    assert_eq!(error_code(fixture.create_branch(BRANCH)), "git");
}

#[test]
fn invalid_branch_names_are_rejected_before_anything_is_created() {
    let fixture = Fixture::repo();
    for bad in [
        "",
        "-x",
        "--force",
        "has space",
        "a..b",
        "x.lock",
        "@{-1}",
        "tilde~1",
        "a:b",
        "end/",
        "HEAD",
        "back\\slash",
    ] {
        assert_eq!(
            error_code(fixture.create_branch(bad)),
            "invalid_request",
            "{bad:?}"
        );
        assert_eq!(
            error_code(fixture.switch(bad)),
            "invalid_request",
            "{bad:?}"
        );
        assert_eq!(
            error_code(fixture.delete_branch(bad, true)),
            "invalid_request",
            "{bad:?}"
        );
    }
    assert_eq!(names(&fixture), [BRANCH]);
}

#[test]
fn switching_moves_head_and_the_working_files() {
    let fixture = Fixture::repo();
    fixture.git(&["switch", "--quiet", "-c", "other"]);
    fixture.write("only-on-other.txt", "o\n");
    fixture.commit_all("other work");

    let status = fixture.switch(BRANCH).expect("switch back");
    assert_eq!(status.branch.as_deref(), Some(BRANCH));
    assert!(!fixture.exists("only-on-other.txt"));
    let status = fixture.switch("other").expect("switch forward");
    assert_eq!(status.branch.as_deref(), Some("other"));
    assert!(fixture.exists("only-on-other.txt"));
}

#[test]
fn switching_keeps_local_changes_that_do_not_collide() {
    let fixture = Fixture::repo();
    fixture.git(&["switch", "--quiet", "-c", "other"]);
    fixture.write("only-on-other.txt", "o\n");
    fixture.commit_all("other work");
    fixture.git(&["switch", "--quiet", BRANCH]);
    fixture.write("b.txt", "local edit\n");

    let status = fixture.switch("other").expect("switch carries the edit");
    assert_eq!(status.branch.as_deref(), Some("other"));
    assert_eq!(fixture.read("b.txt"), "local edit\n");
}

#[test]
fn switching_is_refused_when_local_changes_would_be_overwritten() {
    let fixture = Fixture::repo();
    fixture.git(&["switch", "--quiet", "-c", "other"]);
    fixture.write("a.txt", "other's version\n");
    fixture.commit_all("other edits a");
    fixture.git(&["switch", "--quiet", BRANCH]);
    fixture.write("a.txt", "my uncommitted edit\n");

    let error = fixture.switch("other").expect_err("refused");
    assert_eq!(error.code(), "git");
    assert!(error.to_string().contains("a.txt"), "{error}");
    assert_eq!(fixture.git(&["branch", "--show-current"]), BRANCH);
    assert_eq!(fixture.read("a.txt"), "my uncommitted edit\n");
}

#[test]
fn switching_to_a_branch_that_does_not_exist_is_an_error() {
    let fixture = Fixture::repo();
    assert_eq!(error_code(fixture.switch("nope")), "invalid_request");
}

#[test]
fn a_merged_branch_can_be_deleted() {
    let fixture = Fixture::repo();
    fixture.git(&["branch", "done"]);
    let status = fixture.delete_branch("done", false).expect("delete");
    assert_eq!(status.branch.as_deref(), Some(BRANCH));
    assert_eq!(names(&fixture), [BRANCH]);
}

#[test]
fn an_unmerged_branch_needs_force_to_be_deleted() {
    let fixture = Fixture::repo();
    fixture.git(&["switch", "--quiet", "-c", "risky"]);
    fixture.write("risky.txt", "r\n");
    fixture.commit_all("unmerged work");
    fixture.git(&["switch", "--quiet", BRANCH]);

    assert_eq!(error_code(fixture.delete_branch("risky", false)), "git");
    assert_eq!(names(&fixture), [BRANCH, "risky"]);
    fixture.delete_branch("risky", true).expect("forced delete");
    assert_eq!(names(&fixture), [BRANCH]);
}

#[test]
fn the_branch_you_are_on_cannot_be_deleted() {
    let fixture = Fixture::repo();
    assert_eq!(error_code(fixture.delete_branch(BRANCH, true)), "git");
    assert_eq!(names(&fixture), [BRANCH]);
}
