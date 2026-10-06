use std::collections::HashSet;
use std::io;
use std::mem::size_of;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

use super::TreeError;

const ERROR_NO_MORE_FILES: i32 = 18;

/// Pids of this process's direct children whose executable is one of `names`.
pub fn own_children_named(names: &[&str]) -> Result<HashSet<u32>, TreeError> {
    // SAFETY: plain value arguments; the result is checked before use.
    let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if raw == INVALID_HANDLE_VALUE {
        return Err(last_error("snapshot the process list"));
    }
    // SAFETY: `raw` is a fresh, valid handle that nothing else owns.
    let snapshot = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut entry = PROCESSENTRY32W {
        dwSize: u32::try_from(size_of::<PROCESSENTRY32W>())
            .map_err(|error| TreeError::new("size a process entry", error))?,
        ..PROCESSENTRY32W::default()
    };
    let me = std::process::id();
    let mut found = HashSet::new();
    // SAFETY: `entry` has its size set and outlives every call; the snapshot is open.
    let mut more = unsafe { Process32FirstW(snapshot.as_raw_handle(), &mut entry) } != 0;
    while more {
        if entry.th32ParentProcessID == me && is_named(&entry.szExeFile, names) {
            found.insert(entry.th32ProcessID);
        }
        // SAFETY: as above.
        more = unsafe { Process32NextW(snapshot.as_raw_handle(), &mut entry) } != 0;
    }
    let end = io::Error::last_os_error();
    if end.raw_os_error() != Some(ERROR_NO_MORE_FILES) {
        return Err(TreeError::new("walk the process list", end));
    }
    Ok(found)
}

fn is_named(exe_file: &[u16], names: &[&str]) -> bool {
    let length = exe_file
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(exe_file.len());
    let exe = String::from_utf16_lossy(&exe_file[..length]);
    names.iter().any(|name| exe.eq_ignore_ascii_case(name))
}

fn last_error(action: &'static str) -> TreeError {
    TreeError::new(action, io::Error::last_os_error())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wide(text: &str) -> Vec<u16> {
        let mut units: Vec<u16> = text.encode_utf16().collect();
        units.resize(260, 0);
        units
    }

    #[test]
    fn names_match_case_insensitively_up_to_the_terminator() {
        assert!(is_named(&wide("OpenConsole.exe"), &["openconsole.exe"]));
        assert!(is_named(
            &wide("conhost.exe"),
            &["OpenConsole.exe", "CONHOST.EXE"]
        ));
        assert!(!is_named(&wide("conhost.exe.bak"), &["conhost.exe"]));
        assert!(!is_named(&wide(""), &["conhost.exe"]));
    }

    #[test]
    fn finds_a_direct_child_by_its_executable_name() {
        let mut child = std::process::Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("spawn ping");
        let found = own_children_named(&["ping.exe"]);
        child.kill().expect("stop ping");
        child.wait().expect("reap ping");

        assert!(found.expect("list children").contains(&child.id()));
    }

    #[test]
    fn a_name_nobody_has_matches_nothing() {
        let found = own_children_named(&["flare-no-such-process.exe"]).expect("list children");
        assert!(found.is_empty());
    }
}
