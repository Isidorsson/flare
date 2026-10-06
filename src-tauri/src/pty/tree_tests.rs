//! A shell's descendants must die with it: when it is killed, when it exits on
//! its own, when every terminal is closed at once, and when Flare itself crashes.

use std::sync::Arc;

use crate::proctree::probe::{report_then_crash, Helper, Watched, CRASH_CODE};

use super::session::Session;
use super::state::PtyState;
use super::test_support::{
    channel_sink, config, interactive, one_shot, reply_through_state, shell, start, StateLease,
    Transcript, TIMEOUT,
};

const LONG_PING: &str = "ping -n 60 127.0.0.1\r";
/// `-WindowStyle Hidden` gives ping a console of its own, so closing the pty cannot reach it.
const DETACHED_PING: &str = "$p = Start-Process ping -ArgumentList '-n','60','127.0.0.1' \
    -WindowStyle Hidden -PassThru; Write-Output \"PING=$($p.Id);\"; Start-Sleep -Seconds 2";
const PING_MARKER: &str = "PING=";
const STARTING_HELPER: &str = "pty::tree_tests::crash_helper_starting_shell";
const RUNNING_HELPER: &str = "pty::tree_tests::crash_helper_running_shell";
const PIDS_REPORT: &str = "FLARE_PTY_PIDS=";

/// Every process that ever joined a session, each held by a handle so a recycled
/// pid is never mistaken for a survivor. Dropping it kills whatever is left.
#[derive(Default)]
struct Sightings(Vec<Watched>);

impl Sightings {
    fn record(&mut self, pids: &[u32]) {
        for pid in pids {
            if !self.0.iter().any(|seen| seen.pid() == *pid) {
                self.0.extend(Watched::open(*pid));
            }
        }
    }

    fn count(&self) -> usize {
        self.0.len()
    }

    fn assert_all_gone(&self) {
        for seen in &self.0 {
            assert!(
                seen.wait_gone(TIMEOUT),
                "process {} outlived its session",
                seen.pid()
            );
        }
    }
}

#[test]
fn killing_a_session_kills_what_its_shell_started() {
    let (session, mut run) = start(interactive());
    session
        .write(LONG_PING.as_bytes().to_vec())
        .expect("start a grandchild");
    let mut sightings = Sightings::default();
    let joined = run.wait_until(|_| {
        sightings.record(&session.member_pids().expect("list members"));
        sightings.count() >= 2
    });
    assert!(joined, "the grandchild never joined the session");

    session.kill().expect("kill");

    assert!(run.wait_for_exit().is_some());
    sightings.assert_all_gone();
}

fn announced_ping(text: &str) -> Option<u32> {
    let (_, after) = text.split_once(PING_MARKER)?;
    let (digits, rest) = after.split_at(after.find(|c: char| !c.is_ascii_digit())?);
    rest.starts_with(';').then(|| digits.parse().ok())?
}

#[test]
fn a_shell_that_exits_takes_a_child_with_its_own_console_with_it() {
    let args = ["-NoLogo", "-NoProfile", "-Command", DETACHED_PING];
    let (_session, mut run) = start(shell("powershell.exe", &args));
    assert!(
        run.wait_until(|run| announced_ping(&run.text()).is_some()),
        "powershell never announced its ping; output was {:?}",
        run.text()
    );
    let ping = announced_ping(&run.text()).and_then(Watched::open);
    let ping = ping.expect("ping is running");

    assert_eq!(run.wait_for_exit(), Some(0));

    assert!(
        ping.wait_gone(TIMEOUT),
        "the ping outlived the shell that started it"
    );
}

#[test]
fn a_shell_that_exits_takes_its_background_children_with_it() {
    let script = "start /b ping -n 60 127.0.0.1 & ping -n 3 127.0.0.1 > nul";
    let (session, mut run) = start(one_shot(script));
    let mut sightings = Sightings::default();
    let joined = run.wait_until(|_| {
        sightings.record(&session.member_pids().expect("list members"));
        sightings.count() >= 3
    });
    assert!(joined, "the background ping never joined the session");

    assert_eq!(run.wait_for_exit(), Some(0));

    sightings.assert_all_gone();
}

#[test]
fn kill_all_takes_every_sessions_descendants_with_it() {
    let lease = StateLease(Arc::new(PtyState::default()));
    let state = &lease.0;
    let mut runs: Vec<Transcript> = Vec::new();
    for id in ["a", "b"] {
        let (sink, events) = channel_sink();
        state
            .spawn(id, &config(interactive()), sink)
            .expect("spawn");
        state
            .write(id, LONG_PING.as_bytes().to_vec())
            .expect("start a grandchild");
        runs.push(Transcript::new(events, reply_through_state(state, id)));
    }
    let mut sightings = Sightings::default();
    for (run, id) in runs.iter_mut().zip(["a", "b"]) {
        let before = sightings.count();
        let joined = run.wait_until(|_| {
            sightings.record(&state.member_pids(id).expect("list members"));
            sightings.count() >= before + 2
        });
        assert!(joined, "session {id} never started its grandchild");
    }

    assert_eq!(state.kill_all().into_count().expect("kill all"), 2);

    for run in &mut runs {
        assert!(run.wait_for_exit().is_some());
    }
    sightings.assert_all_gone();
}

fn pids_report(session: &Session) -> String {
    let mut pids = session.member_pids().expect("list shell processes");
    pids.extend(session.host_pids().expect("list console host"));
    let pids: Vec<String> = pids.iter().map(u32::to_string).collect();
    format!("{PIDS_REPORT}{}", pids.join(","))
}

/// The shell is still attaching to its console: nobody answers the cursor query.
#[test]
#[ignore = "helper process of the crash tests; blocks on stdin"]
fn crash_helper_starting_shell() {
    let (session, _run) = start(interactive());
    report_then_crash(&pids_report(&session));
}

#[test]
#[ignore = "helper process of the crash tests; blocks on stdin"]
fn crash_helper_running_shell() {
    let (session, mut run) = start(interactive());
    session
        .write(LONG_PING.as_bytes().to_vec())
        .expect("start a grandchild");
    let joined = run.wait_until(|_| session.member_pids().expect("list members").len() >= 2);
    assert!(joined, "the grandchild never joined the session");
    report_then_crash(&pids_report(&session));
}

fn assert_a_crash_leaves_nothing(helper_test: &str, at_least: usize) {
    let mut helper = Helper::spawn(helper_test);
    let report = helper.read_report(PIDS_REPORT);
    let watched: Vec<Watched> = report
        .split(',')
        .map(|pid| pid.parse().expect("a numeric pid"))
        .filter_map(Watched::open)
        .collect();
    assert!(
        watched.len() >= at_least,
        "expected at least {at_least} live processes, saw {report}"
    );

    assert_eq!(helper.crash(), Some(CRASH_CODE));

    for process in &watched {
        assert!(
            process.wait_gone(TIMEOUT),
            "process {} outlived the Flare that spawned it",
            process.pid()
        );
    }
}

#[test]
fn a_crash_while_a_shell_is_starting_leaves_no_shell_and_no_console_host() {
    assert_a_crash_leaves_nothing(STARTING_HELPER, 2);
}

#[test]
fn a_crash_takes_a_running_shells_grandchildren_with_it() {
    assert_a_crash_leaves_nothing(RUNNING_HELPER, 3);
}
