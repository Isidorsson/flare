//! Keeps the index in step with the workspace watcher in `crate::fs`.

use std::path::Path;
use std::thread;

use tauri::{AppHandle, Manager};

use crate::fs::{ChangeKind, FsChange, FsState, WatchBatch};

use super::commands::notify_if_changed;
use super::error::GraphError;
use super::model::Change;
use super::state::GraphState;

pub fn spawn(app: AppHandle) {
    let (_, batches) = app.state::<FsState>().hub().subscribe();
    let graph = app.state::<GraphState>().inner().clone();
    thread::spawn(move || {
        for batch in batches {
            let change = apply_batch(&graph, &batch);
            if let Err(error) = notify_if_changed(&app, change) {
                eprintln!("flare: could not announce a graph change: {error}");
            }
        }
    });
}

/// Applies one watcher batch and reports whether the graph changed. Errors on
/// single files are logged and skipped so one bad file never stalls the feed.
pub fn apply_batch(graph: &GraphState, batch: &WatchBatch) -> Change {
    if !graph.is_indexed() {
        return Change::Unchanged;
    }
    if batch.rescan {
        return rebuild(graph, &batch.root);
    }
    let mut changed = false;
    for change in &batch.changes {
        changed |= apply_change(graph, change) != Change::Unchanged;
    }
    if changed {
        Change::Updated
    } else {
        Change::Unchanged
    }
}

fn rebuild(graph: &GraphState, root: &str) -> Change {
    match graph.build(Path::new(root)) {
        Ok(_) => Change::Rebuilt,
        Err(error) => {
            eprintln!("flare: rebuilding the graph for {root} failed: {error}");
            Change::Unchanged
        }
    }
}

fn apply_change(graph: &GraphState, change: &FsChange) -> Change {
    let result = match change.kind {
        ChangeKind::Remove => graph.remove_file(&change.path),
        ChangeKind::Create | ChangeKind::Modify => graph.update_file(&change.path),
    };
    match result {
        Ok(change) => change,
        // The watcher can briefly report the previous root while the workspace switches.
        Err(GraphError::OutsideWorkspace(_)) => Change::Unchanged,
        Err(error) => {
            eprintln!("flare: graph update for {} failed: {error}", change.path);
            Change::Unchanged
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn workspace(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::Builder::new()
            .prefix("flare-watch-")
            .tempdir()
            .unwrap();
        for (path, content) in files {
            fs::write(dir.path().join(path), content).unwrap();
        }
        dir
    }

    fn batch(root: &Path, changes: &[(&str, ChangeKind)], rescan: bool) -> WatchBatch {
        WatchBatch {
            root: root.to_string_lossy().into_owned(),
            changes: changes
                .iter()
                .map(|(path, kind)| FsChange {
                    path: root.join(path).to_string_lossy().into_owned(),
                    kind: *kind,
                })
                .collect(),
            rescan,
        }
    }

    #[test]
    fn ignores_batches_until_the_graph_is_built() {
        let dir = workspace(&[("a.ts", "")]);
        let graph = GraphState::default();
        let created = batch(dir.path(), &[("a.ts", ChangeKind::Create)], false);
        assert_eq!(apply_batch(&graph, &created), Change::Unchanged);
        assert!(!graph.is_indexed());
    }

    #[test]
    fn a_new_import_updates_the_graph() {
        let dir = workspace(&[("a.ts", ""), ("b.ts", "")]);
        let graph = GraphState::default();
        graph.build(dir.path()).unwrap();
        fs::write(dir.path().join("a.ts"), "import './b';").unwrap();
        let modified = batch(dir.path(), &[("a.ts", ChangeKind::Modify)], false);
        assert_eq!(apply_batch(&graph, &modified), Change::Updated);
        assert_eq!(graph.snapshot().unwrap().edges.len(), 1);
    }

    #[test]
    fn a_removed_file_leaves_the_graph() {
        let dir = workspace(&[("a.ts", ""), ("b.ts", "")]);
        let graph = GraphState::default();
        graph.build(dir.path()).unwrap();
        fs::remove_file(dir.path().join("b.ts")).unwrap();
        let removed = batch(dir.path(), &[("b.ts", ChangeKind::Remove)], false);
        assert_eq!(apply_batch(&graph, &removed), Change::Updated);
        assert_eq!(graph.snapshot().unwrap().nodes.len(), 1);
    }

    #[test]
    fn non_source_edits_do_not_count_as_changes() {
        let dir = workspace(&[("a.ts", ""), ("notes.md", "")]);
        let graph = GraphState::default();
        graph.build(dir.path()).unwrap();
        let edited = batch(dir.path(), &[("notes.md", ChangeKind::Modify)], false);
        assert_eq!(apply_batch(&graph, &edited), Change::Unchanged);
    }

    #[test]
    fn a_rescan_rebuilds_from_disk() {
        let dir = workspace(&[("a.ts", "")]);
        let graph = GraphState::default();
        graph.build(dir.path()).unwrap();
        fs::write(dir.path().join("c.ts"), "").unwrap();
        assert_eq!(
            apply_batch(&graph, &batch(dir.path(), &[], true)),
            Change::Rebuilt
        );
        assert_eq!(graph.snapshot().unwrap().nodes.len(), 2);
    }
}
