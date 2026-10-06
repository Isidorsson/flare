//! Workspace filesystem access for the webview, plus a change feed for other
//! Rust modules.
//!
//! The graph indexer consumes the feed with
//! `app.state::<FsState>().hub().subscribe()`, which returns a receiver of
//! debounced [`WatchBatch`]es. Gitignored paths and `.git/` never appear in
//! them. A batch with `rescan: true` and no changes means "re-read the whole
//! workspace": it is published when a workspace is opened and when the OS
//! drops events. `FsState::workspace_root()` gives the current root.

mod coalesce;
pub mod commands;
mod error;
mod hub;
mod ignore_rules;
mod io;
mod sandbox;
mod state;
mod tree;
mod watcher;

pub use error::FsError;
pub use hub::{ChangeKind, FsChange, SubscriptionId, WatchBatch, WatchHub};
pub use ignore_rules::IgnoreMatcher;
pub use state::FsState;
