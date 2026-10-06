use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr::null;

use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

use super::TreeError;

/// What a killed process reports, matching `TerminateProcess` in the std library.
const KILLED_EXIT_CODE: u32 = 1;

pub struct Tree {
    job: OwnedHandle,
}

impl Tree {
    pub fn adopt(pid: u32) -> Result<Self, TreeError> {
        let job = create_kill_on_close_job()?;
        let process = open_process(pid)?;
        // SAFETY: both handles are open and owned by this frame for the whole call.
        let assigned =
            unsafe { AssignProcessToJobObject(job.as_raw_handle(), process.as_raw_handle()) };
        if assigned == 0 {
            return Err(last_error("assign the process to its job"));
        }
        Ok(Self { job })
    }

    pub fn terminate(&self) -> Result<(), TreeError> {
        // SAFETY: the job handle is open for as long as `self` lives.
        let terminated = unsafe { TerminateJobObject(self.job.as_raw_handle(), KILLED_EXIT_CODE) };
        if terminated == 0 {
            return Err(last_error("terminate the process tree"));
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn member_pids(&self) -> Result<Vec<u32>, TreeError> {
        use windows_sys::Win32::System::JobObjects::{
            JobObjectBasicProcessIdList, QueryInformationJobObject, JOBOBJECT_BASIC_PROCESS_ID_LIST,
        };

        use std::ptr::null_mut;

        const CAPACITY: usize = 256;
        const WORD: usize = std::mem::size_of::<usize>();
        let mut buffer =
            vec![0usize; std::mem::size_of::<JOBOBJECT_BASIC_PROCESS_ID_LIST>() / WORD + CAPACITY];
        let length = u32::try_from(buffer.len() * WORD)
            .map_err(|error| TreeError::new("size the process list", error))?;
        // SAFETY: `buffer` is writable for `length` bytes and aligned for the list header.
        let queried = unsafe {
            QueryInformationJobObject(
                self.job.as_raw_handle(),
                JobObjectBasicProcessIdList,
                buffer.as_mut_ptr().cast(),
                length,
                null_mut(),
            )
        };
        if queried == 0 {
            return Err(last_error("list the processes in the tree"));
        }
        let list = buffer.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>();
        // SAFETY: the call above filled the header, and the ids that follow it lie inside `buffer`.
        let ids = unsafe {
            let count = (*list).NumberOfProcessIdsInList as usize;
            let first = std::ptr::addr_of!((*list).ProcessIdList).cast::<usize>();
            std::slice::from_raw_parts(first, count)
        };
        ids.iter()
            .map(|id| {
                u32::try_from(*id).map_err(|error| TreeError::new("read a process id", error))
            })
            .collect()
    }
}

fn create_kill_on_close_job() -> Result<OwnedHandle, TreeError> {
    // SAFETY: both arguments are optional and null selects an unnamed job with default security.
    let raw = unsafe { CreateJobObjectW(null(), null()) };
    if raw.is_null() {
        return Err(last_error("create the job object"));
    }
    // SAFETY: `raw` is a fresh handle that nothing else owns.
    let job = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let length = u32::try_from(std::mem::size_of_val(&limits))
        .map_err(|error| TreeError::new("size the job limits", error))?;
    // SAFETY: `limits` is a fully initialised struct of the class and size passed with it.
    let configured = unsafe {
        SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&limits).cast(),
            length,
        )
    };
    if configured == 0 {
        return Err(last_error("make the job kill its processes on close"));
    }
    Ok(job)
}

fn open_process(pid: u32) -> Result<OwnedHandle, TreeError> {
    // SAFETY: plain value arguments; the result is checked before use.
    let raw = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
    if raw.is_null() {
        return Err(last_error("open the process"));
    }
    // SAFETY: `raw` is a fresh handle that nothing else owns.
    Ok(unsafe { OwnedHandle::from_raw_handle(raw) })
}

fn last_error(action: &'static str) -> TreeError {
    TreeError::new(action, io::Error::last_os_error())
}
