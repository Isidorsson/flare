use crate::vcs::model::Change;

use super::support::{find, paths, run_git_expecting_failure, Fixture, BRANCH};

#[test]
fn a_clean_repository_reports_its_branch_and_head() {
    let fixture = Fixture::repo();
    let status = fixture.status();
    assert!(status.is_repo);
    assert_eq!(status.branch.as_deref(), Some(BRANCH));
    assert_eq!(status.head.as_deref(), Some(&fixture.head()[..7]));
    assert_eq!(status.upstream, None);
    assert_eq!((status.ahead, status.behind), (0, 0));
    assert!(status.files.is_empty());
}

#[test]
fn staged_unstaged_and_untracked_changes_are_told_apart() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.write("b.txt", "b2\n");
    fixture.git(&["add", "b.txt"]);
    fixture.write("b.txt", "b3\n");
    fixture.write("new.txt", "new\n");
    fixture.remove("keep.txt");

    let status = fixture.status();
    assert_eq!(paths(&status), ["a.txt", "b.txt", "keep.txt", "new.txt"]);
    let a = find(&status, "a.txt");
    assert_eq!((a.staged, a.unstaged), (None, Some(Change::Modified)));
    let b = find(&status, "b.txt");
    assert_eq!(
        (b.staged, b.unstaged),
        (Some(Change::Modified), Some(Change::Modified))
    );
    let keep = find(&status, "keep.txt");
    assert_eq!((keep.staged, keep.unstaged), (None, Some(Change::Deleted)));
    let new = find(&status, "new.txt");
    assert_eq!((new.staged, new.unstaged), (None, Some(Change::Untracked)));
}

#[test]
fn a_staged_rename_is_one_entry_with_its_old_name() {
    let fixture = Fixture::repo();
    fixture.git(&["mv", "a.txt", "renamed.txt"]);
    let status = fixture.status();
    assert_eq!(paths(&status), ["renamed.txt"]);
    let renamed = find(&status, "renamed.txt");
    assert_eq!(renamed.orig_path.as_deref(), Some("a.txt"));
    assert_eq!(renamed.staged, Some(Change::Renamed));
    assert_eq!(renamed.unstaged, None);
}

#[test]
fn untracked_folders_are_listed_file_by_file() {
    let fixture = Fixture::repo();
    fixture.write("dir/one.txt", "1");
    fixture.write("dir/deep/two.txt", "2");
    let status = fixture.status();
    assert_eq!(paths(&status), ["dir/deep/two.txt", "dir/one.txt"]);
}

#[test]
fn ignored_files_are_not_listed() {
    let fixture = Fixture::repo();
    fixture.write(".gitignore", "*.log\n");
    fixture.write("debug.log", "noise");
    fixture.write("src/app.log", "noise");
    assert_eq!(paths(&fixture.status()), [".gitignore"]);
}

#[test]
fn paths_with_spaces_and_non_ascii_characters_come_through_unaltered() {
    let fixture = Fixture::repo();
    fixture.write("dir with space/ünï cödé 日本.txt", "x");
    let status = fixture.status();
    assert_eq!(paths(&status), ["dir with space/ünï cödé 日本.txt"]);
}

#[test]
fn a_repository_with_no_commits_has_no_head_but_lists_its_files() {
    let fixture = Fixture::unborn();
    fixture.write("first.txt", "1");
    fixture.write("second.txt", "2");
    fixture.git(&["add", "first.txt"]);
    let status = fixture.status();
    assert!(status.is_repo);
    assert_eq!(status.branch.as_deref(), Some(BRANCH));
    assert_eq!(status.head, None);
    let first = find(&status, "first.txt");
    assert_eq!((first.staged, first.unstaged), (Some(Change::Added), None));
    assert_eq!(
        find(&status, "second.txt").unstaged,
        Some(Change::Untracked)
    );
}

#[test]
fn a_detached_head_has_no_branch_name() {
    let fixture = Fixture::repo();
    fixture.git(&["checkout", "--quiet", "--detach"]);
    let status = fixture.status();
    assert_eq!(status.branch, None);
    assert_eq!(status.head.as_deref(), Some(&fixture.head()[..7]));
}

#[test]
fn a_conflicted_merge_lists_the_file_as_conflicted() {
    let fixture = Fixture::repo();
    fixture.git(&["switch", "--quiet", "-c", "topic"]);
    fixture.write("a.txt", "topic side\n");
    fixture.commit_all("topic edit");
    fixture.git(&["switch", "--quiet", BRANCH]);
    fixture.write("a.txt", "main side\n");
    fixture.commit_all("main edit");
    run_git_expecting_failure(&fixture.root, &["merge", "topic"]);

    let status = fixture.status();
    let conflicted = find(&status, "a.txt");
    assert_eq!(conflicted.staged, None);
    assert_eq!(conflicted.unstaged, Some(Change::Conflicted));
}

#[test]
fn a_folder_outside_any_repository_is_reported_as_such_not_as_an_error() {
    let fixture = Fixture::plain();
    let status = fixture.status();
    assert!(!status.is_repo);
    assert_eq!(status.branch, None);
    assert_eq!(status.head, None);
    assert_eq!(status.upstream, None);
    assert_eq!((status.ahead, status.behind), (0, 0));
    assert!(status.files.is_empty());
}

#[test]
fn a_missing_folder_is_an_error() {
    let fixture = Fixture::repo();
    let gone = fixture.path("no/such/folder");
    let request = crate::vcs::model::RootRequest {
        root: gone.to_string_lossy().into_owned(),
    };
    let error = fixture.state.status(request).expect_err("no such folder");
    assert_eq!(error.code(), "io");
}

#[test]
fn a_folder_inside_a_repository_reports_the_whole_repository_with_paths_from_its_top() {
    let fixture = Fixture::repo();
    fixture.write("pkg/inner.txt", "x");
    fixture.write("outside.txt", "y");
    let request = crate::vcs::model::RootRequest {
        root: fixture.path("pkg").to_string_lossy().into_owned(),
    };
    let status = fixture.state.status(request).expect("status");
    assert!(status.is_repo);
    assert_eq!(paths(&status), ["outside.txt", "pkg/inner.txt"]);
}
