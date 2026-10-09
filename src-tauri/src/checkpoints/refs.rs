//! The hidden ref namespace snapshots are stored under.
//!
//! ```text
//! refs/flare/checkpoints/<session>/<turn>/start      the working tree when turn N began
//! refs/flare/checkpoints/<session>/<turn>/end        ... and when it finished
//! refs/flare/checkpoints/<session>/restore-<n>/before  the safety snapshot taken before a restore
//! refs/flare/checkpoints/<session>/restore-<n>/after   the tree the restore produced
//! ```
//!
//! A turn is a directory rather than one ref because it holds two snapshots, and git cannot keep
//! `.../3` and `.../3/end` at once. Nothing outside `refs/flare/` is ever written, so branches,
//! tags and the stash are not affected.

use super::error::CheckpointError;
use super::model::Phase;
use crate::git_cli::Git;

pub const REF_ROOT: &str = "refs/flare/checkpoints";
const SESSION_ID_LIMIT: usize = 100;
const RESTORE_SLOT_PREFIX: &str = "restore-";

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SessionId(String);

impl SessionId {
    /// Ids become ref name components, so only characters that are always valid in one pass.
    pub fn parse(raw: &str) -> Result<Self, CheckpointError> {
        let valid = !raw.is_empty()
            && raw.len() <= SESSION_ID_LIMIT
            && raw
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if valid {
            Ok(Self(raw.to_owned()))
        } else {
            Err(CheckpointError::InvalidRequest(format!(
                "session id {raw:?} must be 1 to {SESSION_ID_LIMIT} letters, digits, - or _"
            )))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Slot {
    Turn(u32),
    Restore(u32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Side {
    Start,
    End,
    Before,
    After,
}

impl Side {
    fn name(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::End => "end",
            Self::Before => "before",
            Self::After => "after",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        [Self::Start, Self::End, Self::Before, Self::After]
            .into_iter()
            .find(|side| side.name() == name)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RefKey {
    pub session: SessionId,
    pub slot: Slot,
    pub side: Side,
}

impl RefKey {
    pub fn turn(session: &SessionId, turn: u32, phase: Phase) -> Self {
        let side = match phase {
            Phase::Start => Side::Start,
            Phase::End => Side::End,
        };
        Self {
            session: session.clone(),
            slot: Slot::Turn(turn),
            side,
        }
    }

    pub fn restore(session: &SessionId, id: u32, side: Side) -> Self {
        Self {
            session: session.clone(),
            slot: Slot::Restore(id),
            side,
        }
    }

    pub fn name(&self) -> String {
        let slot = match self.slot {
            Slot::Turn(turn) => turn.to_string(),
            Slot::Restore(id) => format!("{RESTORE_SLOT_PREFIX}{id}"),
        };
        format!(
            "{REF_ROOT}/{}/{slot}/{}",
            self.session.as_str(),
            self.side.name()
        )
    }

    /// Reads a ref name back; anything that is not one of ours is `None`.
    pub fn parse(name: &str) -> Option<Self> {
        let rest = name.strip_prefix(REF_ROOT)?.strip_prefix('/')?;
        let mut parts = rest.split('/');
        let (session, slot, side) = (parts.next()?, parts.next()?, parts.next()?);
        if parts.next().is_some() {
            return None;
        }
        let session = SessionId::parse(session).ok()?;
        let side = Side::parse(side)?;
        let slot = match slot.strip_prefix(RESTORE_SLOT_PREFIX) {
            Some(id) => Slot::Restore(id.parse().ok()?),
            None => Slot::Turn(slot.parse().ok()?),
        };
        let pairs = matches!(
            (slot, side),
            (Slot::Turn(_), Side::Start | Side::End)
                | (Slot::Restore(_), Side::Before | Side::After)
        );
        pairs.then_some(Self {
            session,
            slot,
            side,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredRef {
    pub key: RefKey,
    pub commit: String,
    pub tree: String,
    pub created_at: i64,
}

pub fn list_session(git: &Git, session: &SessionId) -> Result<Vec<StoredRef>, CheckpointError> {
    list(git, &format!("{REF_ROOT}/{}", session.as_str()))
}

pub fn list_all(git: &Git) -> Result<Vec<StoredRef>, CheckpointError> {
    list(git, REF_ROOT)
}

fn list(git: &Git, pattern: &str) -> Result<Vec<StoredRef>, CheckpointError> {
    let output = git
        .command([
            "for-each-ref",
            "--format=%(refname) %(objectname) %(tree) %(committerdate:unix)",
            pattern,
        ])
        .run()?;
    let text = output.text()?;
    let mut refs = Vec::new();
    for line in text.lines() {
        if let Some(stored) = parse_listed(line)? {
            refs.push(stored);
        }
    }
    Ok(refs)
}

fn parse_listed(line: &str) -> Result<Option<StoredRef>, CheckpointError> {
    let malformed = || CheckpointError::Output {
        command: "for-each-ref".to_owned(),
        detail: format!("unreadable line {line:?}"),
    };
    let mut fields = line.split(' ');
    let (Some(name), Some(commit), Some(tree), Some(date)) =
        (fields.next(), fields.next(), fields.next(), fields.next())
    else {
        return Err(malformed());
    };
    let Some(key) = RefKey::parse(name) else {
        return Ok(None);
    };
    Ok(Some(StoredRef {
        key,
        commit: commit.to_owned(),
        tree: tree.to_owned(),
        created_at: date.parse().map_err(|_| malformed())?,
    }))
}

/// Creates the refs and deletes others in one transaction. Creating fails if a ref exists, so a
/// snapshot is never silently replaced, and then nothing in the transaction is applied.
pub fn update(
    git: &Git,
    created: &[&StoredRef],
    deleted: &[String],
) -> Result<(), CheckpointError> {
    let mut script = String::new();
    for stored in created {
        script.push_str(&format!("create {} {}\n", stored.key.name(), stored.commit));
    }
    for name in deleted {
        script.push_str(&format!("delete {name}\n"));
    }
    if script.is_empty() {
        return Ok(());
    }
    git.command(["update-ref", "--stdin"])
        .stdin(script.into_bytes())
        .run()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> SessionId {
        SessionId::parse("5f3c-AB_9").expect("valid")
    }

    #[test]
    fn session_ids_must_be_safe_ref_components() {
        for bad in ["", "a/b", "a b", "..", "a.lock", "é", &"x".repeat(101)] {
            assert!(SessionId::parse(bad).is_err(), "{bad:?}");
        }
        assert!(SessionId::parse(&"x".repeat(100)).is_ok());
    }

    #[test]
    fn turn_refs_round_trip() {
        let key = RefKey::turn(&session(), 12, Phase::End);
        assert_eq!(key.name(), "refs/flare/checkpoints/5f3c-AB_9/12/end");
        assert_eq!(RefKey::parse(&key.name()), Some(key));
    }

    #[test]
    fn restore_refs_round_trip() {
        let key = RefKey::restore(&session(), 3, Side::Before);
        assert_eq!(
            key.name(),
            "refs/flare/checkpoints/5f3c-AB_9/restore-3/before"
        );
        assert_eq!(RefKey::parse(&key.name()), Some(key));
    }

    #[test]
    fn foreign_and_mismatched_refs_are_not_ours() {
        for name in [
            "refs/heads/main",
            "refs/flare/checkpoints/s1/3",
            "refs/flare/checkpoints/s1/3/start/extra",
            "refs/flare/checkpoints/s1/x/start",
            "refs/flare/checkpoints/s1/3/before",
            "refs/flare/checkpoints/s1/restore-3/start",
            "refs/flare/checkpoints/s1/restore-x/before",
            "refs/flare/checkpoints/bad id/3/start",
            "refs/flare/other/s1/3/start",
        ] {
            assert_eq!(RefKey::parse(name), None, "{name}");
        }
    }

    #[test]
    fn listed_lines_become_stored_refs() {
        let line = "refs/flare/checkpoints/s1/2/end aaa bbb 1700000000";
        let stored = parse_listed(line).expect("parses").expect("ours");
        assert_eq!(
            stored.key,
            RefKey::turn(&SessionId::parse("s1").expect("id"), 2, Phase::End)
        );
        assert_eq!(
            (stored.commit.as_str(), stored.tree.as_str()),
            ("aaa", "bbb")
        );
        assert_eq!(stored.created_at, 1_700_000_000);
    }

    #[test]
    fn listed_lines_that_are_not_ours_are_skipped_and_garbage_is_an_error() {
        assert_eq!(
            parse_listed("refs/flare/other/x aaa bbb 1").expect("ok"),
            None
        );
        assert!(parse_listed("refs/flare/checkpoints/s1/2/end aaa").is_err());
        assert!(parse_listed("refs/flare/checkpoints/s1/2/end aaa bbb soon").is_err());
    }
}
