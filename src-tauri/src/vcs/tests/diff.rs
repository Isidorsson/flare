use crate::vcs::blobs::TEXT_LIMIT;

use super::support::{error_code, run_git_expecting_failure, Fixture, BRANCH};

#[test]
fn an_unstaged_edit_compares_the_index_with_the_working_file() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    let diff = fixture.file_diff("a.txt", false).expect("diff");
    assert_eq!(diff.path, "a.txt");
    assert_eq!(diff.original.as_deref(), Some("a1\n"));
    assert_eq!(diff.modified.as_deref(), Some("a2\n"));
    assert!(!diff.binary);
}

#[test]
fn a_staged_edit_compares_head_with_the_index_and_ignores_later_edits() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "staged\n");
    fixture.stage(&["a.txt"]).expect("stage");
    fixture.write("a.txt", "edited afterwards\n");

    let staged = fixture.file_diff("a.txt", true).expect("staged diff");
    assert_eq!(staged.original.as_deref(), Some("a1\n"));
    assert_eq!(staged.modified.as_deref(), Some("staged\n"));
    let unstaged = fixture.file_diff("a.txt", false).expect("unstaged diff");
    assert_eq!(unstaged.original.as_deref(), Some("staged\n"));
    assert_eq!(unstaged.modified.as_deref(), Some("edited afterwards\n"));
}

#[test]
fn an_untracked_file_has_no_original() {
    let fixture = Fixture::repo();
    fixture.write("new.txt", "fresh\n");
    let diff = fixture.file_diff("new.txt", false).expect("diff");
    assert_eq!(diff.original, None);
    assert_eq!(diff.modified.as_deref(), Some("fresh\n"));
}

#[test]
fn a_deleted_file_has_no_modified_side() {
    let fixture = Fixture::repo();
    fixture.remove("b.txt");
    let unstaged = fixture.file_diff("b.txt", false).expect("diff");
    assert_eq!(unstaged.original.as_deref(), Some("b1\n"));
    assert_eq!(unstaged.modified, None);

    fixture.stage(&["b.txt"]).expect("stage the deletion");
    let staged = fixture.file_diff("b.txt", true).expect("staged diff");
    assert_eq!(staged.original.as_deref(), Some("b1\n"));
    assert_eq!(staged.modified, None);
}

#[test]
fn a_newly_staged_file_has_no_original_even_before_the_first_commit() {
    let fixture = Fixture::unborn();
    fixture.write("first.txt", "one\n");
    fixture.stage(&["first.txt"]).expect("stage");
    let staged = fixture.file_diff("first.txt", true).expect("diff");
    assert_eq!(staged.original, None);
    assert_eq!(staged.modified.as_deref(), Some("one\n"));
}

#[test]
fn a_staged_rename_is_compared_with_the_file_it_came_from() {
    let fixture = Fixture::repo();
    let original = "line one
line two
line three
line four
line five
";
    fixture.write("notes.txt", original);
    fixture.commit_all("add notes");
    fixture.git(&["mv", "notes.txt", "renamed notes.txt"]);
    let edited = format!(
        "{original}line six
"
    );
    fixture.write("renamed notes.txt", &edited);
    fixture.git(&["add", "renamed notes.txt"]);

    let diff = fixture.file_diff("renamed notes.txt", true).expect("diff");
    assert_eq!(diff.original.as_deref(), Some(original));
    assert_eq!(diff.modified.as_deref(), Some(edited.as_str()));
}

#[test]
fn an_empty_file_is_an_empty_text_not_a_missing_side() {
    let fixture = Fixture::repo();
    fixture.write("empty.txt", "");
    let diff = fixture.file_diff("empty.txt", false).expect("diff");
    assert_eq!(diff.original, None);
    assert_eq!(diff.modified.as_deref(), Some(""));
}

#[test]
fn binary_files_report_no_text_on_either_side() {
    let fixture = Fixture::repo();
    fixture.write_bytes("logo.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR");
    fixture.commit_all("add logo");
    fixture.write_bytes("logo.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\x01");

    let unstaged = fixture.file_diff("logo.png", false).expect("diff");
    assert!(unstaged.binary);
    assert_eq!((unstaged.original, unstaged.modified), (None, None));
    fixture.stage(&["logo.png"]).expect("stage");
    let staged = fixture.file_diff("logo.png", true).expect("staged diff");
    assert!(staged.binary);
    assert_eq!((staged.original, staged.modified), (None, None));
}

#[test]
fn a_file_too_large_to_show_is_reported_as_binary() {
    let fixture = Fixture::repo();
    fixture.write_bytes("huge.sql", &vec![b'x'; TEXT_LIMIT + 1]);
    let diff = fixture.file_diff("huge.sql", false).expect("diff");
    assert!(diff.binary);
    assert_eq!(diff.modified, None);
}

#[test]
fn a_conflicted_file_is_compared_with_our_side() {
    let fixture = Fixture::repo();
    fixture.git(&["switch", "--quiet", "-c", "topic"]);
    fixture.write("a.txt", "topic side\n");
    fixture.commit_all("topic edit");
    fixture.git(&["switch", "--quiet", BRANCH]);
    fixture.write("a.txt", "main side\n");
    fixture.commit_all("main edit");
    run_git_expecting_failure(&fixture.root, &["merge", "topic"]);

    let diff = fixture.file_diff("a.txt", false).expect("diff");
    assert_eq!(diff.original.as_deref(), Some("main side\n"));
    assert!(diff
        .modified
        .expect("the file with markers")
        .contains("<<<<<<<"));
}

#[test]
fn a_file_in_a_subfolder_uses_its_full_path() {
    let fixture = Fixture::repo();
    fixture.write("src/deep/mod.rs", "fn a() {}\n");
    fixture.commit_all("add deep");
    fixture.write("src/deep/mod.rs", "fn b() {}\n");
    let diff = fixture.file_diff("src/deep/mod.rs", false).expect("diff");
    assert_eq!(diff.original.as_deref(), Some("fn a() {}\n"));
    assert_eq!(diff.modified.as_deref(), Some("fn b() {}\n"));
}

#[test]
fn paths_that_leave_the_repository_are_rejected() {
    let fixture = Fixture::repo();
    for bad in [
        "../outside.txt",
        "a/../../x",
        "/etc/hosts",
        "C:/x",
        "",
        "a\nb",
    ] {
        for staged in [false, true] {
            assert_eq!(
                error_code(fixture.file_diff(bad, staged)),
                "invalid_request",
                "{bad:?}"
            );
        }
    }
}

#[test]
fn a_folder_outside_any_repository_cannot_be_diffed() {
    let fixture = Fixture::plain();
    assert_eq!(
        error_code(fixture.file_diff("a.txt", false)),
        "not_a_repository"
    );
}

#[test]
fn a_nested_repository_shown_as_a_folder_has_no_text() {
    let fixture = Fixture::repo();
    fixture.write("nested/.git/HEAD", "ref: refs/heads/main\n");
    let diff = fixture.file_diff("nested/", false).expect("diff");
    assert_eq!(
        (diff.original, diff.modified, diff.binary),
        (None, None, false)
    );
}
