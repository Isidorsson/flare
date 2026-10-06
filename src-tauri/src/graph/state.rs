use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use super::error::GraphError;
use super::indexer::Indexer;
use super::model::{BlastRadius, Change, GraphSnapshot};

#[derive(Clone, Default)]
pub struct GraphState {
    inner: Arc<Mutex<Option<Indexer>>>,
}

impl GraphState {
    pub fn build(&self, root: &Path) -> Result<GraphSnapshot, GraphError> {
        let indexer = Indexer::build(root)?;
        let snapshot = indexer.snapshot();
        *self.lock()? = Some(indexer);
        Ok(snapshot)
    }

    pub fn snapshot(&self) -> Result<GraphSnapshot, GraphError> {
        self.with_indexer(|indexer| Ok(indexer.snapshot()))
    }

    pub fn blast_radius(&self, path: &str) -> Result<BlastRadius, GraphError> {
        self.with_indexer(|indexer| indexer.blast_radius(path))
    }

    pub fn update_file(&self, path: &str) -> Result<Change, GraphError> {
        self.with_indexer(|indexer| indexer.update_file(path))
    }

    pub fn remove_file(&self, path: &str) -> Result<Change, GraphError> {
        self.with_indexer(|indexer| indexer.remove_file(path))
    }

    fn lock(&self) -> Result<MutexGuard<'_, Option<Indexer>>, GraphError> {
        self.inner.lock().map_err(|_| GraphError::Poisoned)
    }

    fn with_indexer<T>(
        &self,
        action: impl FnOnce(&mut Indexer) -> Result<T, GraphError>,
    ) -> Result<T, GraphError> {
        let mut guard = self.lock()?;
        let indexer = guard.as_mut().ok_or(GraphError::NotIndexed)?;
        action(indexer)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn workspace(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::Builder::new()
            .prefix("flare-state-")
            .tempdir()
            .unwrap();
        for (path, content) in files {
            let full = dir.path().join(path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, content).unwrap();
        }
        dir
    }

    #[test]
    fn every_query_fails_before_the_first_build() {
        let state = GraphState::default();
        assert_eq!(state.snapshot().unwrap_err(), GraphError::NotIndexed);
        assert_eq!(
            state.blast_radius("a.ts").unwrap_err(),
            GraphError::NotIndexed
        );
        assert_eq!(
            state.update_file("a.ts").unwrap_err(),
            GraphError::NotIndexed
        );
        assert_eq!(
            state.remove_file("a.ts").unwrap_err(),
            GraphError::NotIndexed
        );
    }

    #[test]
    fn build_publishes_the_snapshot_and_later_queries_see_it() {
        let dir = workspace(&[("a.ts", "import './b';"), ("b.ts", "")]);
        let state = GraphState::default();
        let built = state.build(dir.path()).unwrap();
        assert_eq!(built.nodes.len(), 2);
        assert_eq!(state.snapshot().unwrap(), built);
        let radius = state.blast_radius("b.ts").unwrap();
        assert_eq!(radius.nodes.len(), 1);
    }

    #[test]
    fn rebuilding_replaces_the_previous_index() {
        let first = workspace(&[("a.ts", "")]);
        let second = workspace(&[("x.py", ""), ("y.py", "")]);
        let state = GraphState::default();
        state.build(first.path()).unwrap();
        state.build(second.path()).unwrap();
        assert_eq!(state.snapshot().unwrap().nodes.len(), 2);
    }

    #[test]
    fn a_failed_build_keeps_the_previous_index() {
        let dir = workspace(&[("a.ts", "")]);
        let state = GraphState::default();
        state.build(dir.path()).unwrap();
        assert!(state.build(&dir.path().join("missing")).is_err());
        assert_eq!(state.snapshot().unwrap().nodes.len(), 1);
    }

    #[test]
    fn clones_share_one_index() {
        let dir = workspace(&[("a.ts", "")]);
        let state = GraphState::default();
        let other = state.clone();
        state.build(dir.path()).unwrap();
        assert_eq!(other.snapshot().unwrap().nodes.len(), 1);
    }

    #[test]
    fn a_poisoned_lock_is_reported_not_ignored() {
        let state = GraphState::default();
        let inner = Arc::clone(&state.inner);
        let result = std::thread::spawn(move || {
            let _guard = inner.lock().unwrap();
            panic!("poison the lock");
        })
        .join();
        assert!(result.is_err());
        assert_eq!(state.snapshot().unwrap_err(), GraphError::Poisoned);
    }
}
