//! Test-only views of live Windows processes. They hold handles, so a pid cannot
//! be reused while it is watched, and they kill survivors when dropped so a
//! failed assertion never leaves an orphan behind.

use std::io::{self, BufRead, BufReader, Write};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use windows_sys::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::System::Threading::{
    OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
};

const ERROR_INVALID_PARAMETER: i32 = 87;
const REPORT_TIMEOUT: Duration = Duration::from_secs(30);
pub const CRASH_CODE: i32 = 3;

pub struct Watched {
    pid: u32,
    handle: OwnedHandle,
}

impl Watched {
    /// `None` when no such process is running any more.
    pub fn open(pid: u32) -> Option<Self> {
        // SAFETY: plain value arguments; the result is checked before use.
        let raw = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, 0, pid) };
        if raw.is_null() {
            let error = io::Error::last_os_error();
            assert_eq!(
                error.raw_os_error(),
                Some(ERROR_INVALID_PARAMETER),
                "could not open process {pid}: {error}"
            );
            return None;
        }
        // SAFETY: `raw` is a fresh handle that nothing else owns.
        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        Some(Self { pid, handle })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn is_running(&self) -> bool {
        self.wait(Duration::ZERO) == WAIT_TIMEOUT
    }

    pub fn wait_gone(&self, timeout: Duration) -> bool {
        self.wait(timeout) == WAIT_OBJECT_0
    }

    fn wait(&self, timeout: Duration) -> u32 {
        let millis = u32::try_from(timeout.as_millis()).expect("timeout fits in u32 milliseconds");
        // SAFETY: the handle is open for as long as `self` lives.
        unsafe { WaitForSingleObject(self.handle.as_raw_handle(), millis) }
    }
}

impl Drop for Watched {
    fn drop(&mut self) {
        if !self.is_running() {
            return;
        }
        // SAFETY: the handle is open and was opened with terminate rights.
        let killed = unsafe { TerminateProcess(self.handle.as_raw_handle(), 1) };
        if killed == 0 {
            eprintln!(
                "flare test: could not clean up process {}: {}",
                self.pid,
                io::Error::last_os_error()
            );
        }
    }
}

/// A copy of this test binary running one `#[ignore]`d helper test that plays
/// Flare: it starts something, reports what to watch, and on command dies
/// without running a destructor. Killed on drop if a test fails first.
pub struct Helper(Child);

impl Helper {
    pub fn spawn(helper_test: &str) -> Self {
        let exe = std::env::current_exe().expect("test binary path");
        let child = Command::new(exe)
            .args(["--exact", helper_test, "--ignored", "--nocapture"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn helper");
        Self(child)
    }

    /// The text after `prefix` on the first helper line that starts with it.
    pub fn read_report(&mut self, prefix: &'static str) -> String {
        let stdout = self.0.stdout.take().expect("helper stdout is piped");
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let found = BufReader::new(stdout)
                .lines()
                .map_while(Result::ok)
                .find_map(|line| line.strip_prefix(prefix).map(str::to_owned));
            tx.send(found).ok();
        });
        rx.recv_timeout(REPORT_TIMEOUT)
            .expect("the helper never reported")
            .expect("the helper exited without reporting")
    }

    /// Releases the helper, which then crashes, and returns its exit code.
    pub fn crash(&mut self) -> Option<i32> {
        let stdin = self.0.stdin.as_mut().expect("helper stdin is piped");
        writeln!(stdin).expect("release the helper");
        self.0.wait().expect("helper exits").code()
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        if let Err(error) = self.0.kill() {
            eprintln!("flare test: could not stop the helper: {error}");
        }
        if let Err(error) = self.0.wait() {
            eprintln!("flare test: could not reap the helper: {error}");
        }
    }
}

/// Called by a helper test once it has started what the parent will watch.
pub fn report_then_crash(report: &str) -> ! {
    println!("{report}");
    io::stdout().flush().expect("flush stdout");
    let mut release = String::new();
    io::stdin()
        .read_line(&mut release)
        .expect("wait for release");
    std::process::exit(CRASH_CODE)
}
