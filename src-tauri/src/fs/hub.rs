use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde::Serialize;

pub type SubscriptionId = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Create,
    Modify,
    Remove,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FsChange {
    pub path: String,
    pub kind: ChangeKind,
}

/// One debounced burst of filesystem activity. `rescan` means events were
/// lost and subscribers must re-read whatever they cache.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WatchBatch {
    pub root: String,
    pub changes: Vec<FsChange>,
    pub rescan: bool,
}

/// Fan-out of watcher batches. The webview forwarder is one subscriber; the
/// code graph indexer takes another with `subscribe()` and reads its receiver.
#[derive(Debug, Clone, Default)]
pub struct WatchHub {
    state: Arc<Mutex<HubState>>,
}

#[derive(Debug, Default)]
struct HubState {
    next_id: SubscriptionId,
    subscribers: HashMap<SubscriptionId, Sender<Arc<WatchBatch>>>,
}

impl WatchHub {
    pub fn subscribe(&self) -> (SubscriptionId, Receiver<Arc<WatchBatch>>) {
        let (sender, receiver) = mpsc::channel();
        let mut state = self.lock();
        state.next_id += 1;
        let id = state.next_id;
        state.subscribers.insert(id, sender);
        (id, receiver)
    }

    pub fn unsubscribe(&self, id: SubscriptionId) -> bool {
        self.lock().subscribers.remove(&id).is_some()
    }

    pub fn publish(&self, batch: WatchBatch) {
        let batch = Arc::new(batch);
        self.lock()
            .subscribers
            .retain(|_, sender| sender.send(Arc::clone(&batch)).is_ok());
    }

    pub fn subscriber_count(&self) -> usize {
        self.lock().subscribers.len()
    }

    fn lock(&self) -> MutexGuard<'_, HubState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch(path: &str) -> WatchBatch {
        WatchBatch {
            root: "C:/ws".to_owned(),
            changes: vec![FsChange {
                path: path.to_owned(),
                kind: ChangeKind::Modify,
            }],
            rescan: false,
        }
    }

    #[test]
    fn delivers_each_batch_to_every_subscriber() {
        let hub = WatchHub::default();
        let (_, first) = hub.subscribe();
        let (_, second) = hub.subscribe();
        hub.publish(batch("C:/ws/a.ts"));
        assert_eq!(*first.try_recv().expect("first"), batch("C:/ws/a.ts"));
        assert_eq!(*second.try_recv().expect("second"), batch("C:/ws/a.ts"));
    }

    #[test]
    fn unsubscribe_stops_delivery_and_closes_the_receiver() {
        let hub = WatchHub::default();
        let (id, receiver) = hub.subscribe();
        assert!(hub.unsubscribe(id));
        assert!(!hub.unsubscribe(id));
        hub.publish(batch("C:/ws/a.ts"));
        assert!(receiver.recv().is_err());
    }

    #[test]
    fn prunes_subscribers_whose_receiver_was_dropped() {
        let hub = WatchHub::default();
        let (_, kept) = hub.subscribe();
        let (_, dropped) = hub.subscribe();
        drop(dropped);
        hub.publish(batch("C:/ws/a.ts"));
        assert_eq!(hub.subscriber_count(), 1);
        assert!(kept.try_recv().is_ok());
    }

    #[test]
    fn clones_share_the_same_subscribers() {
        let hub = WatchHub::default();
        let publisher = hub.clone();
        let (_, receiver) = hub.subscribe();
        publisher.publish(batch("C:/ws/b.ts"));
        assert!(receiver.try_recv().is_ok());
    }

    #[test]
    fn change_kinds_serialize_lowercase() {
        let json = serde_json::to_value(batch("C:/ws/a.ts")).expect("serializes");
        assert_eq!(json["changes"][0]["kind"], "modify");
        assert_eq!(json["rescan"], false);
    }
}
