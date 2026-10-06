use std::collections::HashMap;
use std::sync::Arc;

use super::error::PtyError;

pub struct SessionRegistry<S> {
    sessions: HashMap<String, Arc<S>>,
}

impl<S> Default for SessionRegistry<S> {
    fn default() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

impl<S> SessionRegistry<S> {
    pub fn contains(&self, id: &str) -> bool {
        self.sessions.contains_key(id)
    }

    pub fn insert(&mut self, id: String, session: Arc<S>) -> Result<(), PtyError> {
        if self.contains(&id) {
            return Err(PtyError::Duplicate(id));
        }
        self.sessions.insert(id, session);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Arc<S>, PtyError> {
        self.sessions
            .get(id)
            .cloned()
            .ok_or_else(|| PtyError::NotFound(id.to_owned()))
    }

    pub fn remove(&mut self, id: &str) -> Result<Arc<S>, PtyError> {
        self.sessions
            .remove(id)
            .ok_or_else(|| PtyError::NotFound(id.to_owned()))
    }

    pub fn drain(&mut self) -> Vec<Arc<S>> {
        self.sessions.drain().map(|(_, session)| session).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inserts_and_looks_up_sessions_by_id() {
        let mut registry = SessionRegistry::default();
        registry.insert("a".into(), Arc::new(1)).unwrap();
        registry.insert("b".into(), Arc::new(2)).unwrap();

        assert_eq!(*registry.get("a").unwrap(), 1);
        assert_eq!(*registry.get("b").unwrap(), 2);
        assert!(registry.contains("a") && registry.contains("b"));
    }

    #[test]
    fn rejects_a_duplicate_id_and_keeps_the_original() {
        let mut registry = SessionRegistry::default();
        registry.insert("a".into(), Arc::new(1)).unwrap();

        let error = registry.insert("a".into(), Arc::new(2)).unwrap_err();

        assert!(matches!(error, PtyError::Duplicate(id) if id == "a"));
        assert_eq!(*registry.get("a").unwrap(), 1);
    }

    #[test]
    fn reports_missing_ids() {
        let mut registry: SessionRegistry<u8> = SessionRegistry::default();

        assert!(matches!(registry.get("x"), Err(PtyError::NotFound(_))));
        assert!(matches!(registry.remove("x"), Err(PtyError::NotFound(_))));
    }

    #[test]
    fn remove_returns_the_session_and_frees_the_id() {
        let mut registry = SessionRegistry::default();
        registry.insert("a".into(), Arc::new(7)).unwrap();

        assert_eq!(*registry.remove("a").unwrap(), 7);
        assert!(!registry.contains("a"));
        registry.insert("a".into(), Arc::new(8)).unwrap();
    }

    #[test]
    fn drain_empties_the_registry() {
        let mut registry = SessionRegistry::default();
        registry.insert("a".into(), Arc::new(1)).unwrap();
        registry.insert("b".into(), Arc::new(2)).unwrap();

        let mut drained: Vec<i32> = registry.drain().iter().map(|s| **s).collect();
        drained.sort_unstable();

        assert_eq!(drained, vec![1, 2]);
        assert!(!registry.contains("a") && !registry.contains("b"));
    }
}
