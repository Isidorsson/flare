//! A pty shell is a session and process group leader, so its group is its tree.
//! Descendants that move themselves into another group (job-control shells do)
//! are not reached; only the Windows job object is airtight.

use std::io;

use super::TreeError;

pub struct Tree {
    pid: libc::pid_t,
}

impl Tree {
    pub fn adopt(pid: u32) -> Result<Self, TreeError> {
        let pid = libc::pid_t::try_from(pid)
            .map_err(|error| TreeError::new("read the process id", error))?;
        if pid <= 1 {
            return Err(TreeError::new("read the process id", "not a spawned child"));
        }
        Ok(Self { pid })
    }

    /// A child that is not a group leader (the agent bridge) has no group of its own, so it is
    /// signalled directly. Nothing left to signal is success.
    pub fn terminate(&self) -> Result<(), TreeError> {
        signal_kill(-self.pid)
            .and_then(|found| {
                if found {
                    Ok(true)
                } else {
                    signal_kill(self.pid)
                }
            })
            .map(drop)
            .map_err(|error| TreeError::new("terminate the process tree", error))
    }
}

/// `Ok(false)` means no such process or group.
fn signal_kill(target: libc::pid_t) -> io::Result<bool> {
    // SAFETY: `kill` takes plain integers and has no memory side effects.
    if unsafe { libc::kill(target, libc::SIGKILL) } == 0 {
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(false);
    }
    Err(error)
}
