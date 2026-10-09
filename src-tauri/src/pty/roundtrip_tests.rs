//! Spawns real shells through the native pty (ConPTY on Windows).

use std::sync::Arc;

use super::error::PtyError;
use super::state::PtyState;
use super::test_support::{
    channel_sink, config, interactive, one_shot, reply_through_state, start, StateLease,
    Transcript, TIMEOUT,
};

#[test]
fn one_shot_command_streams_its_output_and_exits_with_zero() {
    let (_session, mut run) = start(one_shot("echo flare-pty-ok"));

    run.wait_for_text("flare-pty-ok");

    assert_eq!(run.wait_for_exit(), Some(0));
}

#[test]
fn a_nonzero_exit_code_is_reported() {
    let (_session, mut run) = start(one_shot("exit 7"));

    assert_eq!(run.wait_for_exit(), Some(7));
}

#[test]
fn typed_input_reaches_the_shell_and_exit_code_comes_back() {
    let (session, mut run) = start(interactive());

    session
        .write(b"echo flare-input-ok\r".to_vec())
        .expect("write input");
    run.wait_for_text("flare-input-ok");
    session.write(b"exit 3\r".to_vec()).expect("write exit");

    assert_eq!(run.wait_for_exit(), Some(3));
    assert!(session.wait_finished(TIMEOUT));
}

#[cfg(windows)]
#[test]
fn the_default_windows_shell_starts_and_reports_its_exit_code() {
    use super::profiles::{detect_profiles, resolve_launch, Launch};
    use super::shell::{is_executable_candidate, ShellEnv};

    let profiles = detect_profiles(&ShellEnv::current(), is_executable_candidate);
    let spec = resolve_launch(&Launch::Shell { profile: None }, &profiles).expect("default shell");
    let (session, mut run) = start(spec);

    session.write(b"exit 5\r".to_vec()).expect("write exit");

    assert_eq!(run.wait_for_exit(), Some(5));
}

#[test]
fn kill_terminates_a_running_shell_and_reports_the_exit() {
    let (session, mut run) = start(interactive());

    session.kill().expect("kill shell");

    assert!(run.wait_for_exit().is_some());
    assert!(session.wait_finished(TIMEOUT));
    session.kill().expect("killing an exited shell is a no-op");
}

#[test]
fn resize_works_while_running_and_fails_after_exit() {
    let (session, mut run) = start(interactive());

    session.resize(120, 40).expect("resize running shell");
    session.kill().expect("kill shell");
    run.wait_for_exit();
    assert!(session.wait_finished(TIMEOUT));

    assert!(matches!(session.resize(80, 24), Err(PtyError::Exited(_))));
    assert!(matches!(
        session.write(b"x".to_vec()),
        Err(PtyError::Exited(_))
    ));
}

#[test]
fn state_tracks_sessions_by_id_and_shuts_everything_down() {
    let lease = StateLease(Arc::new(PtyState::default()));
    let state = &lease.0;
    let (sink_a, events_a) = channel_sink();
    let (sink_b, events_b) = channel_sink();

    state
        .spawn("a", &config(interactive()), sink_a)
        .expect("spawn a");
    state
        .spawn("b", &config(interactive()), sink_b)
        .expect("spawn b");
    let mut run_a = Transcript::new(events_a, reply_through_state(state, "a"));
    let mut run_b = Transcript::new(events_b, reply_through_state(state, "b"));
    let (duplicate_sink, _events) = channel_sink();
    let duplicate = state.spawn("a", &config(interactive()), duplicate_sink);
    assert!(matches!(duplicate, Err(PtyError::Duplicate(_))));
    state.resize("a", 90, 20).expect("resize a");

    state.shutdown_all();

    assert!(run_a.wait_for_exit().is_some());
    assert!(run_b.wait_for_exit().is_some());
    assert!(matches!(
        state.write("a", Vec::new()),
        Err(PtyError::NotFound(_))
    ));
}

#[test]
fn kill_removes_the_session_and_closing_it_again_is_a_no_op() {
    let lease = StateLease(Arc::new(PtyState::default()));
    let state = &lease.0;
    let (sink, events) = channel_sink();
    state
        .spawn("a", &config(interactive()), sink)
        .expect("spawn");
    let mut run = Transcript::new(events, reply_through_state(state, "a"));

    assert!(state.kill("a").expect("kill"));

    assert!(run.wait_for_exit().is_some());
    assert!(!state.kill("a").expect("closing a closed session"));
    assert!(!state.kill("never-existed").expect("closing an unknown id"));
}

#[test]
fn kill_all_closes_every_session_and_reports_how_many() {
    let lease = StateLease(Arc::new(PtyState::default()));
    let state = &lease.0;
    let (sink_a, events_a) = channel_sink();
    let (sink_b, events_b) = channel_sink();
    state
        .spawn("a", &config(interactive()), sink_a)
        .expect("spawn a");
    state
        .spawn("b", &config(interactive()), sink_b)
        .expect("spawn b");
    let mut run_a = Transcript::new(events_a, reply_through_state(state, "a"));
    let mut run_b = Transcript::new(events_b, reply_through_state(state, "b"));

    assert_eq!(state.kill_all().into_count().expect("kill all"), 2);

    assert!(run_a.wait_for_exit().is_some());
    assert!(run_b.wait_for_exit().is_some());
    assert_eq!(state.kill_all().into_count().expect("nothing left"), 0);
    assert!(matches!(
        state.write("a", Vec::new()),
        Err(PtyError::NotFound(_))
    ));
}

#[test]
fn killing_a_shell_that_is_still_starting_still_reports_its_exit() {
    let (session, mut run) = start(interactive());

    session.kill().expect("kill during startup");

    assert!(run.wait_for_exit().is_some());
    assert!(session.wait_finished(TIMEOUT));
}
