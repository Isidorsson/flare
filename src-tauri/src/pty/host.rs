//! A pseudo console runs in a host process (conhost.exe or OpenConsole.exe)
//! that Flare starts when the pty is opened, so it is not in the shell's tree.
//! When the shell dies before it attaches, that host never exits on its own: it
//! outlives its session, blocks `ClosePseudoConsole`, and survives a crashed
//! Flare. It therefore gets a tree of its own.

use std::collections::HashSet;
use std::sync::Mutex;

use super::error::PtyError;
use super::session::lock;
use crate::proctree::ProcessTree;

#[cfg(windows)]
const HOST_PROGRAMS: [&str; 2] = ["OpenConsole.exe", "conhost.exe"];

/// Hosts are told apart by when they appeared, which only works one pty at a time.
static OPENING: Mutex<()> = Mutex::new(());

/// Runs `open`, which creates a pty, and adopts the host process it started.
pub fn open_with_host<T>(
    open: impl FnOnce() -> Result<T, PtyError>,
) -> Result<(T, Option<ProcessTree>), PtyError> {
    let _one_at_a_time = lock(&OPENING);
    let Some(before) = console_hosts()? else {
        return open().map(|opened| (opened, None));
    };
    let opened = open()?;
    let appeared: Vec<u32> = console_hosts()?
        .unwrap_or_default()
        .difference(&before)
        .copied()
        .collect();
    let host = match appeared.as_slice() {
        [pid] => Some(adopt_host(*pid)?),
        other => {
            eprintln!(
                "flare pty: expected one new console host, found {}; it will not be tracked",
                other.len()
            );
            None
        }
    };
    Ok((opened, host))
}

fn adopt_host(pid: u32) -> Result<ProcessTree, PtyError> {
    ProcessTree::adopt(pid).map_err(|error| PtyError::backend("contain console host", error))
}

/// `None` where pseudo consoles have no separate host process.
#[cfg(windows)]
fn console_hosts() -> Result<Option<HashSet<u32>>, PtyError> {
    crate::proctree::own_children_named(&HOST_PROGRAMS)
        .map(Some)
        .map_err(|error| PtyError::backend("find the console host", error))
}

#[cfg(not(windows))]
fn console_hosts() -> Result<Option<HashSet<u32>>, PtyError> {
    Ok(None)
}
