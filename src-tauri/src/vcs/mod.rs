//! Git from the Changes tab: status, per-file diffs, staging, commits, branches and the remote.
//!
//! Unlike `checkpoints`, which is built never to touch a user's index, HEAD or branches, this
//! module drives them on purpose, but only when the user clicks. What it promises:
//!
//! - Every command takes the folder the user opened (`root`) and works on the repository that
//!   contains it. Paths in requests and results are relative to that repository's top.
//! - Paths from the webview are checked (relative, no `..`) and handed to git after `--` with
//!   literal pathspecs; branch names are checked with git's own rules; a commit message goes in on
//!   standard input. Nothing is run through a shell.
//! - Output that is parsed is read with `-z`, so file names with spaces, quotes or non-ASCII
//!   characters arrive unaltered.
//! - Commands that change the index, working tree or HEAD queue per repository (`state.rs`).
//!   Status and diffs skip git's optional index refresh so they never fight the user's own git.
//! - Credential prompts are off, so a push that needs a password fails with git's message.
//! - A repository with no commits yet is a normal case everywhere, not an error.
//! - Mutating commands return the fresh `VcsStatus` so the UI needs no second round trip.
//!
//! Git is driven through `crate::git_cli`, the runner shared with `checkpoints`.

mod blobs;
mod branches;
pub mod commands;
mod commit;
mod diff;
mod error;
mod message_context;
mod model;
mod paths;
mod remote;
mod repo;
mod staging;
mod state;
mod status;

#[cfg(test)]
mod tests;

pub use state::VcsState;
