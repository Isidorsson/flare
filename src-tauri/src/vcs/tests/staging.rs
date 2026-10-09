use crate::vcs::model::Change;

use super::support::{error_code, find, paths, Fixture};

#[test]
fn staging_one_file_leaves_the_others_alone() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.write("b.txt", "b2\n");
    let status = fixture.stage(&["a.txt"]).expect("stage");
    assert_eq!(find(&status, "a.txt").staged, Some(Change::Modified));
    assert_eq!(find(&status, "a.txt").unstaged, None);
    assert_eq!(find(&status, "b.txt").staged, None);
    assert_eq!(find(&status, "b.txt").unstaged, Some(Change::Modified));
}

#[test]
fn staging_nothing_in_particular_stages_everything_including_deletions_and_new_files() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.write("new/deep.txt", "n");
    fixture.remove("keep.txt");
    let status = fixture.stage(&[]).expect("stage all");
    assert_eq!(paths(&status), ["a.txt", "keep.txt", "new/deep.txt"]);
    assert_eq!(find(&status, "keep.txt").staged, Some(Change::Deleted));
    assert_eq!(find(&status, "new/deep.txt").staged, Some(Change::Added));
    assert!(status.files.iter().all(|file| file.unstaged.is_none()));
}

#[test]
fn a_deleted_file_can_be_staged_by_name() {
    let fixture = Fixture::repo();
    fixture.remove("b.txt");
    let status = fixture.stage(&["b.txt"]).expect("stage");
    assert_eq!(find(&status, "b.txt").staged, Some(Change::Deleted));
}

#[test]
fn unstaging_puts_the_index_back_and_keeps_the_edit() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.write("b.txt", "b2\n");
    fixture.stage(&[]).expect("stage all");
    let status = fixture.unstage(&["a.txt"]).expect("unstage");
    assert_eq!(find(&status, "a.txt").staged, None);
    assert_eq!(find(&status, "a.txt").unstaged, Some(Change::Modified));
    assert_eq!(find(&status, "b.txt").staged, Some(Change::Modified));
    assert_eq!(fixture.read("a.txt"), "a2\n");
}

#[test]
fn unstaging_nothing_in_particular_unstages_everything() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.write("new.txt", "n");
    fixture.stage(&[]).expect("stage all");
    let status = fixture.unstage(&[]).expect("unstage all");
    assert!(status.files.iter().all(|file| file.staged.is_none()));
    assert_eq!(find(&status, "new.txt").unstaged, Some(Change::Untracked));
    assert_eq!(find(&status, "a.txt").unstaged, Some(Change::Modified));
}

#[test]
fn unstaging_works_before_the_first_commit() {
    let fixture = Fixture::unborn();
    fixture.write("one.txt", "1");
    fixture.write("two.txt", "2");
    fixture.stage(&[]).expect("stage all");
    let status = fixture.unstage(&["one.txt"]).expect("unstage one");
    assert_eq!(find(&status, "one.txt").staged, None);
    assert_eq!(find(&status, "two.txt").staged, Some(Change::Added));
    let status = fixture.unstage(&[]).expect("unstage all");
    assert!(status.files.iter().all(|file| file.staged.is_none()));
    assert_eq!(fixture.read("one.txt"), "1");
}

#[test]
fn discarding_restores_an_edited_and_a_deleted_file_from_the_index() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "scribble\n");
    fixture.remove("b.txt");
    let status = fixture.discard(&["a.txt", "b.txt"]).expect("discard");
    assert!(status.files.is_empty());
    assert_eq!(fixture.read("a.txt"), "a1\n");
    assert_eq!(fixture.read("b.txt"), "b1\n");
}

#[test]
fn discarding_goes_back_to_the_index_not_to_head() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "staged version\n");
    fixture.stage(&["a.txt"]).expect("stage");
    fixture.write("a.txt", "later scribble\n");
    let status = fixture.discard(&["a.txt"]).expect("discard");
    assert_eq!(fixture.read("a.txt"), "staged version\n");
    assert_eq!(find(&status, "a.txt").staged, Some(Change::Modified));
    assert_eq!(find(&status, "a.txt").unstaged, None);
}

#[test]
fn discarding_leaves_other_files_edits_alone() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.write("b.txt", "b2\n");
    fixture.discard(&["a.txt"]).expect("discard");
    assert_eq!(fixture.read("b.txt"), "b2\n");
}

#[test]
fn an_untracked_file_cannot_be_discarded_and_survives() {
    let fixture = Fixture::repo();
    fixture.write("scratch.txt", "mine\n");
    assert_eq!(error_code(fixture.discard(&["scratch.txt"])), "git");
    assert_eq!(fixture.read("scratch.txt"), "mine\n");
}

#[test]
fn discarding_an_empty_list_is_refused_rather_than_read_as_everything() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "precious edit\n");
    assert_eq!(error_code(fixture.discard(&[])), "invalid_request");
    assert_eq!(fixture.read("a.txt"), "precious edit\n");
}

#[test]
fn names_that_look_like_options_or_patterns_are_taken_literally() {
    let fixture = Fixture::repo();
    fixture.write("-f.txt", "dash\n");
    fixture.write("[id].txt", "bracket\n");
    fixture.write("i.txt", "other\n");
    let status = fixture.stage(&["-f.txt", "[id].txt"]).expect("stage");
    assert_eq!(find(&status, "-f.txt").staged, Some(Change::Added));
    assert_eq!(find(&status, "[id].txt").staged, Some(Change::Added));
    assert_eq!(find(&status, "i.txt").staged, None);
}

#[test]
fn a_wildcard_does_not_expand_to_other_files() {
    let fixture = Fixture::repo();
    fixture.write("one.rs", "1");
    fixture.write("two.rs", "2");
    let error = fixture.stage(&["*.rs"]).expect_err("no file is named that");
    assert_eq!(error.code(), "git");
    assert!(fixture
        .status()
        .files
        .iter()
        .all(|file| file.staged.is_none()));
}

#[test]
fn paths_outside_the_repository_are_rejected_before_git_runs() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    for bad in [
        "../outside.txt",
        "sub/../../x",
        "/etc/passwd",
        "C:\\Windows\\x",
        "",
    ] {
        assert_eq!(
            error_code(fixture.stage(&[bad])),
            "invalid_request",
            "{bad}"
        );
        assert_eq!(
            error_code(fixture.unstage(&[bad])),
            "invalid_request",
            "{bad}"
        );
        assert_eq!(
            error_code(fixture.discard(&[bad])),
            "invalid_request",
            "{bad}"
        );
    }
    assert_eq!(fixture.read("a.txt"), "a2\n");
}

#[test]
fn one_bad_path_in_a_list_stops_the_whole_request() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    assert_eq!(
        error_code(fixture.stage(&["a.txt", "../bad"])),
        "invalid_request"
    );
    assert!(fixture
        .status()
        .files
        .iter()
        .all(|file| file.staged.is_none()));
}

#[test]
fn staging_a_long_list_of_files_works_in_one_request() {
    let fixture = Fixture::repo();
    let names: Vec<String> = (0..400)
        .map(|n| {
            format!(
                "generated/a-fairly-long-folder-name-to-use-up-command-line-space/file-{n:04}.txt"
            )
        })
        .collect();
    for name in &names {
        fixture.write(name, "x");
    }
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let status = fixture.stage(&refs).expect("stage many");
    assert_eq!(status.files.len(), names.len());
    assert!(status
        .files
        .iter()
        .all(|file| file.staged == Some(Change::Added)));
}

#[test]
fn clicks_in_quick_succession_queue_instead_of_failing_on_the_index_lock() {
    let fixture = Fixture::repo();
    let names: Vec<String> = (0..8).map(|n| format!("burst-{n}.txt")).collect();
    for name in &names {
        fixture.write(name, "x");
    }
    std::thread::scope(|scope| {
        let handles: Vec<_> = names
            .iter()
            .map(|name| scope.spawn(|| fixture.stage(&[name.as_str()])))
            .collect();
        for handle in handles {
            handle
                .join()
                .expect("thread")
                .expect("stage under contention");
        }
    });
    let status = fixture.status();
    assert_eq!(status.files.len(), names.len());
    assert!(status
        .files
        .iter()
        .all(|file| file.staged == Some(Change::Added)));
}

#[test]
fn staging_in_a_plain_folder_is_an_error() {
    let fixture = Fixture::plain();
    assert_eq!(error_code(fixture.stage(&["a.txt"])), "not_a_repository");
}
