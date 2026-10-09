use std::fs;

use crate::vcs::model::Change;

use super::support::{error_code, find, Fixture, BRANCH};

#[test]
fn committing_records_the_staged_files_and_returns_the_fresh_status() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.write("b.txt", "b2\n");
    fixture.stage(&["a.txt"]).expect("stage");

    let result = fixture.commit("feat: change a").expect("commit");
    assert_eq!(result.summary, "feat: change a");
    assert_eq!(result.commit, fixture.head()[..7]);
    assert_eq!(result.status.head.as_deref(), Some(result.commit.as_str()));
    assert_eq!(fixture.git(&["show", "HEAD:a.txt"]), "a2");
    assert_eq!(fixture.git(&["show", "HEAD:b.txt"]), "b1");
    let b = find(&result.status, "b.txt");
    assert_eq!((b.staged, b.unstaged), (None, Some(Change::Modified)));
    assert_eq!(result.status.files.len(), 1);
}

#[test]
fn the_first_commit_of_a_new_repository_can_be_made() {
    let fixture = Fixture::unborn();
    fixture.write("hello.txt", "hi\n");
    fixture.stage(&[]).expect("stage");
    let result = fixture.commit("chore: start").expect("commit");
    assert_eq!(result.status.branch.as_deref(), Some(BRANCH));
    assert_eq!(result.status.head.as_deref(), Some(result.commit.as_str()));
    assert!(result.status.files.is_empty());
    assert_eq!(fixture.git(&["rev-list", "--count", "HEAD"]), "1");
}

#[test]
fn a_message_with_a_body_is_stored_exactly_as_written() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.stage(&["a.txt"]).expect("stage");
    let message = "fix(a): handle \"quotes\" & $dollars\n\nWhy: the old code lost data.\n\n# not a comment\n- bullet";
    fixture.commit(message).expect("commit");
    assert_eq!(fixture.git(&["log", "-1", "--format=%B"]), message);
}

#[test]
fn a_very_long_message_is_not_limited_by_the_command_line() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.stage(&["a.txt"]).expect("stage");
    let body = "word ".repeat(40_000);
    let message = format!("subject\n\n{}", body.trim_end());
    fixture.commit(&message).expect("commit");
    assert_eq!(fixture.git(&["log", "-1", "--format=%B"]), message);
}

#[test]
fn an_empty_message_is_refused_and_nothing_is_committed() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.stage(&["a.txt"]).expect("stage");
    let before = fixture.head();
    assert_eq!(error_code(fixture.commit("")), "empty_message");
    assert_eq!(error_code(fixture.commit("  \n\t\n")), "empty_message");
    assert_eq!(fixture.head(), before);
    assert_eq!(
        find(&fixture.status(), "a.txt").staged,
        Some(Change::Modified)
    );
}

#[test]
fn committing_with_nothing_staged_is_refused() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    let before = fixture.head();
    assert_eq!(
        error_code(fixture.commit("chore: nothing")),
        "nothing_staged"
    );
    assert_eq!(fixture.head(), before);
}

#[test]
fn committing_in_a_new_repository_with_nothing_staged_is_refused() {
    let fixture = Fixture::unborn();
    fixture.write("untracked.txt", "x");
    assert_eq!(
        error_code(fixture.commit("chore: nothing")),
        "nothing_staged"
    );
}

#[test]
fn committing_in_a_plain_folder_is_an_error() {
    let fixture = Fixture::plain();
    assert_eq!(error_code(fixture.commit("x")), "not_a_repository");
}

#[test]
fn a_hook_that_refuses_the_commit_explains_why() {
    let fixture = Fixture::repo();
    let hook = fixture.path(".git/hooks/pre-commit");
    fs::create_dir_all(hook.parent().expect("hooks dir")).expect("hooks dir");
    fs::write(&hook, "#!/bin/sh\necho 'lint failed: fix it' >&2\nexit 1\n").expect("hook");
    make_executable(&hook);
    fixture.write("a.txt", "a2\n");
    fixture.stage(&["a.txt"]).expect("stage");
    let before = fixture.head();

    let error = fixture.commit("feat: a").expect_err("the hook refuses");
    assert_eq!(error.code(), "git");
    assert!(error.to_string().contains("lint failed: fix it"), "{error}");
    assert_eq!(fixture.head(), before);
}

#[test]
fn a_hook_that_explains_itself_on_standard_output_is_heard_too() {
    let fixture = Fixture::repo();
    let hook = fixture.path(".git/hooks/pre-commit");
    fs::create_dir_all(hook.parent().expect("hooks dir")).expect("hooks dir");
    fs::write(
        &hook,
        "#!/bin/sh
echo 'formatter says no'
exit 1
",
    )
    .expect("hook");
    make_executable(&hook);
    fixture.write(
        "a.txt", "a2
",
    );
    fixture.stage(&["a.txt"]).expect("stage");

    let error = fixture.commit("feat: a").expect_err("the hook refuses");
    assert!(error.to_string().contains("formatter says no"), "{error}");
}

#[cfg(unix)]
fn make_executable(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path).expect("metadata").permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).expect("chmod");
}

#[cfg(not(unix))]
fn make_executable(_path: &std::path::Path) {}
