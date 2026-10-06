//! Decides which files a restore touches and which of them the user changed since.
//!
//! The functions here only compare file states that were already read from git, so every rule is
//! testable without a repository. A file state is `Option<Blob>`: `None` means "no such file".

use std::collections::{HashMap, HashSet};

use super::diff::{Blob, Change};
use super::model::{FileAction, PlannedFile};

/// Put back what a recorded span of time changed, leaving every other file alone.
///
/// `target_vs_expected` is what that span changed (the target state on its old side, the state it
/// left behind on its new side) and `expected_vs_current` is how the files differ from that
/// left-behind state now. A file whose current state is not the left-behind one was edited since,
/// which makes it a conflict; a file that already matches the target needs nothing.
pub fn plan_revert(
    target_vs_expected: &[Change],
    expected_vs_current: &[Change],
) -> Vec<PlannedFile> {
    let drifted: HashMap<&str, &Change> = expected_vs_current
        .iter()
        .map(|change| (change.path.as_str(), change))
        .collect();
    target_vs_expected
        .iter()
        .filter_map(|span| {
            let current = match drifted.get(span.path.as_str()) {
                Some(drift) => drift.new.as_ref(),
                None => span.new.as_ref(),
            };
            planned(
                &span.path,
                span.old.as_ref(),
                current,
                current != span.new.as_ref(),
            )
        })
        .collect()
}

/// Roll everything back to a target state. `current_vs_target` lists every file that differs;
/// those in `user_edited` were changed by someone other than a recorded turn.
pub fn plan_reset(current_vs_target: &[Change], user_edited: &HashSet<String>) -> Vec<PlannedFile> {
    current_vs_target
        .iter()
        .filter_map(|change| {
            planned(
                &change.path,
                change.new.as_ref(),
                change.old.as_ref(),
                user_edited.contains(&change.path),
            )
        })
        .collect()
}

fn planned(
    path: &str,
    target: Option<&Blob>,
    current: Option<&Blob>,
    conflict: bool,
) -> Option<PlannedFile> {
    if target == current {
        return None;
    }
    let action = match (target, current) {
        (None, _) => FileAction::Delete,
        (Some(_), None) => FileAction::Recreate,
        (Some(_), Some(_)) => FileAction::Revert,
    };
    Some(PlannedFile {
        path: path.to_owned(),
        action,
        conflict,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blob(oid: &str) -> Option<Blob> {
        Some(Blob {
            mode: "100644".to_owned(),
            oid: oid.to_owned(),
        })
    }

    fn change(path: &str, old: Option<Blob>, new: Option<Blob>) -> Change {
        Change {
            path: path.to_owned(),
            old,
            new,
            counts: None,
        }
    }

    fn by_path(files: &[PlannedFile], path: &str) -> PlannedFile {
        files
            .iter()
            .find(|file| file.path == path)
            .cloned()
            .unwrap_or_else(|| panic!("{path} is not planned"))
    }

    #[test]
    fn a_turn_that_edited_created_and_deleted_is_reversed_file_by_file() {
        let turn = [
            change("edited.rs", blob("s1"), blob("e1")),
            change("created.rs", None, blob("e2")),
            change("deleted.rs", blob("s3"), None),
        ];
        let files = plan_revert(&turn, &[]);
        assert_eq!(by_path(&files, "edited.rs").action, FileAction::Revert);
        assert_eq!(by_path(&files, "created.rs").action, FileAction::Delete);
        assert_eq!(by_path(&files, "deleted.rs").action, FileAction::Recreate);
        assert!(files.iter().all(|file| !file.conflict));
    }

    #[test]
    fn a_file_the_user_edited_afterwards_is_a_conflict() {
        let turn = [
            change("a.rs", blob("s"), blob("e")),
            change("b.rs", blob("s"), blob("e")),
        ];
        let drift = [change("a.rs", blob("e"), blob("user"))];
        let files = plan_revert(&turn, &drift);
        assert!(by_path(&files, "a.rs").conflict);
        assert!(!by_path(&files, "b.rs").conflict);
    }

    #[test]
    fn a_created_file_deleted_by_the_user_needs_nothing() {
        let turn = [change("created.rs", None, blob("e"))];
        let drift = [change("created.rs", blob("e"), None)];
        assert!(plan_revert(&turn, &drift).is_empty());
    }

    #[test]
    fn a_file_already_back_at_its_old_content_needs_nothing() {
        let turn = [change("a.rs", blob("s"), blob("e"))];
        let drift = [change("a.rs", blob("e"), blob("s"))];
        assert!(plan_revert(&turn, &drift).is_empty());
    }

    #[test]
    fn a_deleted_file_that_the_user_recreated_differently_is_a_conflict() {
        let turn = [change("a.rs", blob("s"), None)];
        let drift = [change("a.rs", None, blob("user"))];
        let files = plan_revert(&turn, &drift);
        let file = by_path(&files, "a.rs");
        assert_eq!(file.action, FileAction::Revert);
        assert!(file.conflict);
    }

    #[test]
    fn a_mode_change_alone_counts_as_a_difference() {
        let exec = Some(Blob {
            mode: "100755".to_owned(),
            oid: "same".to_owned(),
        });
        let turn = [change("run.sh", blob("same"), exec)];
        assert_eq!(plan_revert(&turn, &[]).len(), 1);
    }

    #[test]
    fn resetting_covers_every_difference_and_flags_user_edits() {
        let now_vs_target = [
            change("later.rs", blob("now"), blob("then")),
            change("new.rs", blob("now"), None),
            change("lost.rs", None, blob("then")),
        ];
        let edited: HashSet<String> = ["later.rs".to_owned()].into();
        let files = plan_reset(&now_vs_target, &edited);
        assert_eq!(by_path(&files, "later.rs").action, FileAction::Revert);
        assert!(by_path(&files, "later.rs").conflict);
        assert_eq!(by_path(&files, "new.rs").action, FileAction::Delete);
        assert!(!by_path(&files, "new.rs").conflict);
        assert_eq!(by_path(&files, "lost.rs").action, FileAction::Recreate);
    }
}
