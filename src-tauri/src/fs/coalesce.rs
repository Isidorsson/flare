use std::collections::BTreeMap;
use std::path::PathBuf;

use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind};

use super::hub::ChangeKind;

/// Folds repeated events for one path into the single change a subscriber
/// needs. `None` means the path appeared and vanished inside one window.
pub fn merge(previous: ChangeKind, next: ChangeKind) -> Option<ChangeKind> {
    use ChangeKind::{Create, Modify, Remove};
    match (previous, next) {
        (Create, Modify | Create) => Some(Create),
        (Create, Remove) => None,
        (Modify, Remove) | (Remove, Remove) => Some(Remove),
        (Modify, Modify | Create) | (Remove, Create | Modify) => Some(Modify),
    }
}

#[derive(Debug, Default)]
pub struct Coalescer {
    pending: BTreeMap<PathBuf, ChangeKind>,
    rescan: bool,
}

impl Coalescer {
    pub fn push(&mut self, path: PathBuf, kind: ChangeKind) {
        let Some(previous) = self.pending.get(&path).copied() else {
            self.pending.insert(path, kind);
            return;
        };
        match merge(previous, kind) {
            Some(merged) => {
                self.pending.insert(path, merged);
            }
            None => {
                self.pending.remove(&path);
            }
        }
    }

    pub fn request_rescan(&mut self) {
        self.rescan = true;
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty() && !self.rescan
    }

    pub fn drain(&mut self) -> (BTreeMap<PathBuf, ChangeKind>, bool) {
        (
            std::mem::take(&mut self.pending),
            std::mem::take(&mut self.rescan),
        )
    }
}

pub fn classify(event: &Event) -> Vec<(PathBuf, ChangeKind)> {
    let paths = event.paths.iter().cloned();
    match event.kind {
        EventKind::Access(_) => Vec::new(),
        EventKind::Create(_) => paths.map(|p| (p, ChangeKind::Create)).collect(),
        EventKind::Remove(_) => paths.map(|p| (p, ChangeKind::Remove)).collect(),
        EventKind::Modify(ModifyKind::Name(mode)) => classify_rename(mode, &event.paths),
        EventKind::Modify(_) | EventKind::Any | EventKind::Other => {
            paths.map(|p| (p, ChangeKind::Modify)).collect()
        }
    }
}

fn classify_rename(mode: RenameMode, paths: &[PathBuf]) -> Vec<(PathBuf, ChangeKind)> {
    let tag = |kind: ChangeKind| -> Vec<(PathBuf, ChangeKind)> {
        paths.iter().map(|p| (p.clone(), kind)).collect()
    };
    match mode {
        RenameMode::From => tag(ChangeKind::Remove),
        RenameMode::To => tag(ChangeKind::Create),
        RenameMode::Both => {
            let mut out = Vec::new();
            if let Some(from) = paths.first() {
                out.push((from.clone(), ChangeKind::Remove));
            }
            if let Some(to) = paths.get(1) {
                out.push((to.clone(), ChangeKind::Create));
            }
            out
        }
        RenameMode::Any | RenameMode::Other => tag(ChangeKind::Modify),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, RemoveKind};
    use ChangeKind::{Create, Modify, Remove};

    fn path(name: &str) -> PathBuf {
        PathBuf::from(format!("/ws/{name}"))
    }

    fn drained(co: &mut Coalescer) -> Vec<(String, ChangeKind)> {
        let (pending, _) = co.drain();
        pending
            .into_iter()
            .map(|(p, k)| (p.display().to_string().replace('\\', "/"), k))
            .collect()
    }

    #[test]
    fn merge_table_covers_every_pair() {
        let table = [
            (Create, Create, Some(Create)),
            (Create, Modify, Some(Create)),
            (Create, Remove, None),
            (Modify, Create, Some(Modify)),
            (Modify, Modify, Some(Modify)),
            (Modify, Remove, Some(Remove)),
            (Remove, Create, Some(Modify)),
            (Remove, Modify, Some(Modify)),
            (Remove, Remove, Some(Remove)),
        ];
        for (previous, next, expected) in table {
            assert_eq!(
                merge(previous, next),
                expected,
                "{previous:?} then {next:?}"
            );
        }
    }

    #[test]
    fn collapses_a_burst_of_edits_to_one_modify() {
        let mut co = Coalescer::default();
        for _ in 0..5 {
            co.push(path("a.ts"), Modify);
        }
        assert_eq!(drained(&mut co), [("/ws/a.ts".to_owned(), Modify)]);
    }

    #[test]
    fn create_then_edit_stays_a_create() {
        let mut co = Coalescer::default();
        co.push(path("new.ts"), Create);
        co.push(path("new.ts"), Modify);
        assert_eq!(drained(&mut co), [("/ws/new.ts".to_owned(), Create)]);
    }

    #[test]
    fn create_then_remove_cancels_out_and_a_later_create_survives() {
        let mut co = Coalescer::default();
        co.push(path("tmp"), Create);
        co.push(path("tmp"), Remove);
        assert!(co.is_empty());
        co.push(path("tmp"), Create);
        assert_eq!(drained(&mut co), [("/ws/tmp".to_owned(), Create)]);
    }

    #[test]
    fn tracks_each_path_independently_in_path_order() {
        let mut co = Coalescer::default();
        co.push(path("b"), Remove);
        co.push(path("a"), Modify);
        assert_eq!(
            drained(&mut co),
            [("/ws/a".to_owned(), Modify), ("/ws/b".to_owned(), Remove)]
        );
    }

    #[test]
    fn rescan_counts_as_pending_work_and_drain_resets_it() {
        let mut co = Coalescer::default();
        assert!(co.is_empty());
        co.request_rescan();
        assert!(!co.is_empty());
        let (pending, rescan) = co.drain();
        assert!(pending.is_empty());
        assert!(rescan);
        assert!(co.is_empty());
    }

    fn event(kind: EventKind, paths: &[&str]) -> Event {
        paths
            .iter()
            .fold(Event::new(kind), |e, p| e.add_path(path(p)))
    }

    #[test]
    fn classifies_basic_kinds() {
        let created = event(EventKind::Create(CreateKind::File), &["a"]);
        assert_eq!(classify(&created), [(path("a"), Create)]);
        let removed = event(EventKind::Remove(RemoveKind::File), &["a"]);
        assert_eq!(classify(&removed), [(path("a"), Remove)]);
        let modified = event(EventKind::Modify(ModifyKind::Data(DataChange::Any)), &["a"]);
        assert_eq!(classify(&modified), [(path("a"), Modify)]);
        let unknown = event(EventKind::Any, &["a"]);
        assert_eq!(classify(&unknown), [(path("a"), Modify)]);
    }

    #[test]
    fn ignores_access_events() {
        let access = event(EventKind::Access(AccessKind::Any), &["a"]);
        assert!(classify(&access).is_empty());
    }

    #[test]
    fn classifies_renames_as_remove_plus_create() {
        let from = event(
            EventKind::Modify(ModifyKind::Name(RenameMode::From)),
            &["old"],
        );
        assert_eq!(classify(&from), [(path("old"), Remove)]);
        let to = event(
            EventKind::Modify(ModifyKind::Name(RenameMode::To)),
            &["new"],
        );
        assert_eq!(classify(&to), [(path("new"), Create)]);
        let both = event(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &["old", "new"],
        );
        assert_eq!(
            classify(&both),
            [(path("old"), Remove), (path("new"), Create)]
        );
        let any = event(EventKind::Modify(ModifyKind::Name(RenameMode::Any)), &["x"]);
        assert_eq!(classify(&any), [(path("x"), Modify)]);
    }
}
