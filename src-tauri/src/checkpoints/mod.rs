//! Git checkpoints: a snapshot of the workspace when each agent turn starts and ends, and undo
//! for a turn or for everything since one.
//!
//! What this module promises about a user's repository:
//!
//! - A snapshot never writes the user's index (the working tree is staged into a copy, see
//!   `index.rs`), HEAD, branches, tags, stash, config or working files. It writes only git
//!   objects and refs under `refs/flare/`. `.gitignore`d files are not part of a snapshot, so a
//!   restore never touches them.
//! - A restore touches only the files the chosen turn changed (or, for "restore to before turn
//!   N", the files that differ from that point), and says which of them the user edited since
//!   before it overwrites them. It always saves the current state first, so it can be redone.
//! - A folder outside any repository gets a private bare repository under the app data
//!   directory instead; the folder itself is not modified (no `.git`).
//! - In a repository, files pass through git's own conversions (line endings, `.gitattributes`)
//!   the way `git stash` does, so a restored file follows the user's settings; a private
//!   repository is configured to keep the exact bytes.
//!
//! A "session" here is only the scope snapshots are grouped by; Flare passes the thread id.
//!
//! Git is driven through the `git` executable (`git.rs`), never through a shell.

mod apply;
pub mod commands;
mod diff;
mod error;
mod git;
mod index;
mod model;
mod plan;
mod prune;
mod refs;
mod service;
mod snapshot;
mod state;
mod timeline;
mod workspace;

#[cfg(test)]
mod tests;

pub use commands::spawn_startup_sweep;
pub use state::CheckpointState;
