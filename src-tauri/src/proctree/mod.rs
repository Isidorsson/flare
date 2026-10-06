//! Kills a spawned process together with everything it started.
//!
//! Every shell or sidecar Flare spawns is adopted into its own `ProcessTree`.
//! On Windows that is a job object with `KILL_ON_JOB_CLOSE`, so the tree dies
//! when it is terminated, when the handle is dropped, and when Flare itself
//! exits or crashes: the OS closes every handle the process owned. One job per
//! tree rather than one app-wide job keeps "close this tab" precise (terminating
//! an app-wide job would take every tab down), and an app-wide job would add
//! nothing, because the per-tree handles already die with the process.

#[cfg(windows)]
mod children;
#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

#[cfg(windows)]
pub use children::own_children_named;

#[cfg(all(test, windows))]
pub mod probe;
#[cfg(all(test, windows))]
mod tests;

#[cfg(unix)]
use unix as platform;
#[cfg(windows)]
use windows as platform;

#[derive(Debug, thiserror::Error)]
#[error("failed to {action}: {reason}")]
pub struct TreeError {
    action: &'static str,
    reason: String,
}

impl TreeError {
    fn new(action: &'static str, cause: impl std::fmt::Display) -> Self {
        Self {
            action,
            reason: cause.to_string(),
        }
    }
}

pub struct ProcessTree(platform::Tree);

impl ProcessTree {
    /// Adopt a process that was just spawned. Anything it starts afterwards is
    /// part of the tree. A descendant created before this call returns would be
    /// missed, which no shell can do: they spend longer than that loading.
    pub fn adopt(pid: u32) -> Result<Self, TreeError> {
        platform::Tree::adopt(pid).map(Self)
    }

    /// Kills every process in the tree. Succeeds when there is nothing left to kill.
    pub fn terminate(&self) -> Result<(), TreeError> {
        self.0.terminate()
    }

    #[cfg(all(test, windows))]
    pub fn member_pids(&self) -> Result<Vec<u32>, TreeError> {
        self.0.member_pids()
    }
}
