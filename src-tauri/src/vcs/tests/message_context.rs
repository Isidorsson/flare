use crate::vcs::message_context::{
    MESSAGE_FILE_PATCH_LIMIT, MESSAGE_PATCH_LIMIT, RECENT_BODY_LIMIT,
};
use crate::vcs::model::DiffSource;

use super::support::{error_code, Fixture};

fn numbered_lines(count: usize) -> String {
    (0..count)
        .map(|n| format!("line number {n:06} of generated content\n"))
        .collect()
}

#[test]
fn staged_changes_are_what_gets_described() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.write("b.txt", "b2\n");
    fixture.stage(&["a.txt"]).expect("stage");

    let context = fixture.message_context().expect("context");
    assert_eq!(context.source, DiffSource::Staged);
    assert!(context.stat.contains("a.txt"));
    assert!(!context.stat.contains("b.txt"));
    assert!(context.patch.contains("diff --git a/a.txt b/a.txt"));
    assert!(context.patch.contains("+a2"));
    assert!(context.patch.contains("-a1"));
    assert!(!context.patch.contains("b.txt"));
    assert!(!context.truncated);
}

#[test]
fn with_nothing_staged_every_change_is_described_untracked_files_by_name() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.remove("keep.txt");
    fixture.write("brand-new.txt", "new\n");

    let context = fixture.message_context().expect("context");
    assert_eq!(context.source, DiffSource::All);
    assert!(context.patch.contains("+a2"));
    assert!(context.patch.contains("deleted file mode"));
    assert!(context.stat.contains("a.txt"));
    assert!(context.stat.contains("Untracked files"));
    assert!(context.stat.contains("brand-new.txt"));
    assert!(!context.patch.contains("brand-new.txt"));
}

#[test]
fn staged_work_hides_untracked_files() {
    let fixture = Fixture::repo();
    fixture.write("a.txt", "a2\n");
    fixture.stage(&["a.txt"]).expect("stage");
    fixture.write("brand-new.txt", "new\n");
    let context = fixture.message_context().expect("context");
    assert!(!context.stat.contains("brand-new.txt"));
}

#[test]
fn recent_subjects_are_the_last_ten_newest_first() {
    let fixture = Fixture::repo();
    for n in 1..=12 {
        fixture.git(&[
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            &format!("commit {n}"),
        ]);
    }
    fixture.write("a.txt", "a2\n");
    let context = fixture.message_context().expect("context");
    assert_eq!(context.recent_subjects.len(), 10);
    assert_eq!(context.recent_subjects[0], "commit 12");
    assert_eq!(context.recent_subjects[9], "commit 3");
}

#[test]
fn a_repository_with_no_commits_has_no_subjects_and_still_describes_staged_files() {
    let fixture = Fixture::unborn();
    fixture.write("first.txt", "one\n");
    fixture.stage(&["first.txt"]).expect("stage");
    let context = fixture.message_context().expect("context");
    assert_eq!(context.source, DiffSource::Staged);
    assert!(context.recent_subjects.is_empty());
    assert!(context.patch.contains("+one"));
}

#[test]
fn a_repository_with_no_commits_and_nothing_staged_lists_its_untracked_files() {
    let fixture = Fixture::unborn();
    fixture.write("first.txt", "one\n");
    let context = fixture.message_context().expect("context");
    assert_eq!(context.source, DiffSource::All);
    assert!(context.patch.is_empty());
    assert!(context.stat.contains("first.txt"));
    assert!(context.recent_subjects.is_empty());
}

#[test]
fn no_changes_at_all_is_an_error() {
    let fixture = Fixture::repo();
    assert_eq!(error_code(fixture.message_context()), "nothing_to_describe");
    let fresh = Fixture::unborn();
    assert_eq!(error_code(fresh.message_context()), "nothing_to_describe");
}

#[test]
fn one_huge_file_is_capped_and_does_not_crowd_out_the_others() {
    let fixture = Fixture::repo();
    fixture.write("generated/lock.txt", &numbered_lines(20_000));
    fixture.write("src/small.txt", "the small change that matters\n");
    fixture.stage(&[]).expect("stage all");

    let context = fixture.message_context().expect("context");
    assert!(context.truncated);
    assert!(context.patch.len() <= MESSAGE_PATCH_LIMIT);
    assert!(context.patch.contains("the small change that matters"));
    assert!(context.patch.contains("bytes of this file's diff omitted"));
    let lock_part = &context.patch[..context.patch.find("src/small.txt").expect("small file")];
    assert!(
        lock_part.len() <= MESSAGE_FILE_PATCH_LIMIT + 256,
        "{}",
        lock_part.len()
    );
    assert!(context.patch.ends_with('\n'));
    assert!(context.stat.contains("lock.txt"));
}

#[test]
fn many_files_stop_at_the_total_limit_and_say_how_many_were_left_out() {
    let fixture = Fixture::repo();
    for n in 0..40 {
        fixture.write(&format!("bulk/file-{n:02}.txt"), &numbered_lines(300));
    }
    fixture.stage(&[]).expect("stage all");

    let context = fixture.message_context().expect("context");
    assert!(context.truncated);
    assert!(
        context.patch.len() <= MESSAGE_PATCH_LIMIT,
        "{}",
        context.patch.len()
    );
    assert!(context.patch.contains("more files omitted"));
    assert!(context.patch.contains("bulk/file-00.txt"));
}

#[test]
fn a_binary_file_appears_in_the_stat_and_patch_without_its_bytes() {
    let fixture = Fixture::repo();
    fixture.write_bytes("logo.png", b"\x89PNG\0\0\0binary payload");
    fixture.stage(&["logo.png"]).expect("stage");
    let context = fixture.message_context().expect("context");
    assert!(context.stat.contains("logo.png"));
    assert!(context.patch.contains("Binary files"));
    assert!(!context.patch.contains("binary payload"));
}

#[test]
fn a_very_long_list_of_untracked_files_is_cut_and_marked() {
    let fixture = Fixture::repo();
    for n in 0..80 {
        fixture.write(&format!("scratch/n{n:02}.txt"), "x");
    }
    let context = fixture.message_context().expect("context");
    assert!(context.truncated);
    assert!(context.stat.contains("... and 30 more"));
}

#[test]
fn the_context_names_the_current_branch() {
    let fixture = Fixture::repo();
    fixture.write(
        "a.txt", "a2
",
    );
    assert_eq!(
        fixture
            .message_context()
            .expect("context")
            .branch
            .as_deref(),
        Some("main")
    );
    fixture.create_branch("feat/login").expect("create");
    assert_eq!(
        fixture
            .message_context()
            .expect("context")
            .branch
            .as_deref(),
        Some("feat/login")
    );
}

#[test]
fn a_detached_head_has_no_branch_name() {
    let fixture = Fixture::repo();
    fixture.git(&["checkout", "--quiet", "--detach"]);
    fixture.write(
        "a.txt", "a2
",
    );
    assert_eq!(fixture.message_context().expect("context").branch, None);
}

#[test]
fn a_branch_with_no_commits_yet_is_still_named() {
    let fixture = Fixture::unborn();
    fixture.write(
        "first.txt",
        "one
",
    );
    let context = fixture.message_context().expect("context");
    assert_eq!(context.branch.as_deref(), Some("main"));
    assert!(context.recent_bodies.is_empty());
}

#[test]
fn recent_bodies_are_the_newest_three_that_have_one_trimmed_and_newest_first() {
    let fixture = Fixture::repo();
    fixture.commit_with_body("feat: one", "Body one.");
    fixture.commit_with_body(
        "feat: two",
        "Body two, first paragraph.

Second paragraph.",
    );
    fixture.git(&["commit", "--quiet", "--allow-empty", "-m", "chore: no body"]);
    fixture.commit_with_body("feat: three", "Body three.");
    fixture.commit_with_body("feat: four", "Body four.");
    fixture.write(
        "a.txt", "a2
",
    );

    let context = fixture.message_context().expect("context");
    assert_eq!(
        context.recent_bodies,
        [
            "Body four.",
            "Body three.",
            "Body two, first paragraph.

Second paragraph."
        ]
    );
}

#[test]
fn history_without_any_body_gives_no_bodies() {
    let fixture = Fixture::repo();
    fixture.write(
        "a.txt", "a2
",
    );
    let context = fixture.message_context().expect("context");
    assert!(context.recent_bodies.is_empty());
    assert_eq!(context.recent_subjects, ["initial"]);
}

#[test]
fn a_long_body_is_cut_to_the_limit_in_characters() {
    let fixture = Fixture::repo();
    fixture.commit_with_body("feat: long", &"é".repeat(RECENT_BODY_LIMIT * 3));
    fixture.write(
        "a.txt", "a2
",
    );
    let context = fixture.message_context().expect("context");
    assert_eq!(context.recent_bodies.len(), 1);
    assert_eq!(context.recent_bodies[0].chars().count(), RECENT_BODY_LIMIT);
}

#[test]
fn bodies_in_any_script_are_kept() {
    let fixture = Fixture::repo();
    fixture.commit_with_body("fix: text", "日本語 and Zażółć gęślą jaźń.");
    fixture.write(
        "a.txt", "a2
",
    );
    let context = fixture.message_context().expect("context");
    assert_eq!(context.recent_bodies, ["日本語 and Zażółć gęślą jaźń."]);
}

#[test]
fn only_the_latest_thirty_commits_are_searched_for_bodies() {
    let fixture = Fixture::repo();
    fixture.commit_with_body("feat: far back", "Too old to be found.");
    let filler: Vec<String> = (0..30).map(|n| format!("chore: filler {n}")).collect();
    fixture.commit_empty(&filler);
    fixture.write(
        "a.txt", "a2
",
    );
    let context = fixture.message_context().expect("context");
    assert!(context.recent_bodies.is_empty());
}
