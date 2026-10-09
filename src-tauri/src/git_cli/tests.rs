use super::*;

fn here() -> Git {
    Git::new(std::env::temp_dir())
}

#[test]
fn captures_output_and_trims_the_line_break() {
    let version = here().command(["--version"]).run().expect("git runs");
    assert!(version.text().expect("utf8").starts_with("git version"));
}

#[test]
fn a_failing_command_reports_its_name_and_stderr() {
    let error = here()
        .command(["rev-parse", "--verify", "no-such-rev"])
        .run()
        .expect_err("fails");
    assert!(matches!(error, GitError::Failed { .. }));
    assert!(error.to_string().starts_with("git rev-parse failed:"));
}

#[test]
fn a_refusal_written_to_standard_output_is_not_lost() {
    let error = here()
        .with_global_args(["-c", "alias.refuse=!echo no thanks; exit 1"])
        .command(["refuse"])
        .run()
        .expect_err("the alias exits with 1");
    assert_eq!(error.to_string(), "git refuse failed: no thanks");
}

#[test]
fn standard_error_wins_over_standard_output_when_both_have_text() {
    let alias = "alias.both=!echo to-stdout; echo to-stderr >&2; exit 1";
    let error = here()
        .with_global_args(["-c", alias])
        .command(["both"])
        .run()
        .expect_err("the alias exits with 1");
    assert_eq!(error.to_string(), "git both failed: to-stderr");
}

#[test]
fn unchecked_runs_return_the_exit_code() {
    let output = here()
        .command(["rev-parse", "--verify", "no-such-rev"])
        .run_unchecked()
        .expect("runs");
    assert_ne!(output.code, 0);
}

#[test]
fn a_missing_executable_is_reported_as_git_missing() {
    let error = here()
        .with_program("flare-definitely-not-git")
        .command(["--version"])
        .run()
        .expect_err("no such program");
    assert!(matches!(error, GitError::Missing(_)));
}

#[test]
fn input_reaches_the_process() {
    let output = here()
        .command(["hash-object", "--stdin"])
        .stdin(b"hello\n".to_vec())
        .run()
        .expect("hashes");
    assert_eq!(
        output.text().expect("utf8"),
        "ce013625030ba8dba906f756967f9e9ca394464a"
    );
}

#[test]
fn environment_set_on_one_invocation_reaches_the_process() {
    let git = here();
    let ident = git
        .command(["var", "GIT_AUTHOR_IDENT"])
        .env("GIT_AUTHOR_NAME", "Flare Test")
        .env("GIT_AUTHOR_EMAIL", "flare@example.com")
        .run()
        .expect("ident");
    assert!(ident
        .text()
        .expect("utf8")
        .starts_with("Flare Test <flare@example.com>"));
}

#[test]
fn credential_prompts_are_always_off() {
    let echoed = here()
        .command([
            "-c",
            "alias.show-prompt=!echo $GIT_TERMINAL_PROMPT",
            "show-prompt",
        ])
        .run()
        .expect("alias runs");
    assert_eq!(echoed.text().expect("utf8"), "0");
}

#[test]
fn the_timeout_can_be_changed_per_invocation() {
    let git = here();
    let default = git.command(["--version"]);
    assert_eq!(default.timeout, DEFAULT_TIMEOUT);
    let longer = git.command(["--version"]).timeout(Duration::from_secs(900));
    assert_eq!(longer.timeout, Duration::from_secs(900));
}

#[test]
fn large_input_is_streamed_while_output_is_collected() {
    let blob = vec![b'x'; 4 * 1024 * 1024];
    let hashed = here()
        .command(["hash-object", "--stdin"])
        .stdin(blob)
        .run()
        .expect("hashes");
    assert_eq!(hashed.text().expect("utf8").len(), 40);
}

#[test]
fn a_process_that_stops_reading_input_is_not_a_write_error() {
    let output = here()
        .command(["rev-parse", "--verify", "no-such-rev"])
        .stdin(vec![b'x'; 4 * 1024 * 1024])
        .run_unchecked()
        .expect("the failure comes from git, not from the pipe");
    assert_ne!(output.code, 0);
}

#[test]
fn a_process_that_overruns_its_timeout_is_killed() {
    let mut sleeper = if cfg!(windows) {
        let mut command = Command::new("ping");
        command.args(["-n", "30", "127.0.0.1"]);
        command
    } else {
        let mut command = Command::new("sleep");
        command.arg("30");
        command
    }
    .stdout(Stdio::null())
    .spawn()
    .expect("spawn a sleeper");
    let error = wait(&mut sleeper, Duration::from_millis(50), "sleep").expect_err("times out");
    assert!(matches!(error, GitError::Timeout { .. }));
    assert!(
        sleeper.try_wait().expect("status").is_some(),
        "the process was reaped"
    );
}

fn gh_via_git(alias: &str) -> Git {
    Git::gh(std::env::temp_dir())
        .with_program("git")
        .with_global_args(["-c", alias])
}

#[test]
fn the_github_cli_never_prompts_checks_for_updates_or_colours_output() {
    let echoed = gh_via_git(
        "alias.show-env=!echo $GH_PROMPT_DISABLED $GH_NO_UPDATE_NOTIFIER $NO_COLOR $GIT_TERMINAL_PROMPT",
    )
    .command(["show-env"])
    .run()
    .expect("alias runs");
    assert_eq!(echoed.text().expect("utf8"), "1 1 1 0");
}

#[test]
fn the_github_cli_does_not_get_settings_meant_for_git() {
    let probe = "alias.fsmonitor=!git config --get core.fsmonitor";
    let for_gh = gh_via_git(probe)
        .command(["fsmonitor"])
        .run_unchecked()
        .expect("runs");
    assert_eq!(for_gh.code, 1, "no core.fsmonitor override was passed");
    let for_git = here()
        .with_global_args(["-c", probe])
        .command(["fsmonitor"])
        .run()
        .expect("runs");
    assert_eq!(for_git.text().expect("utf8"), "false");
}

#[test]
fn github_cli_failures_are_named_by_the_two_words_that_pick_the_command() {
    let error = gh_via_git("alias.pr=!f() { echo denied >&2; exit 1; }; f")
        .command(["pr", "create", "--title", "x"])
        .run()
        .expect_err("the alias exits with 1");
    assert!(matches!(
        error,
        GitError::Failed { ref command, ref stderr } if command == "pr create" && stderr == "denied"
    ));
}

#[test]
fn a_missing_github_cli_is_reported_as_missing() {
    let error = Git::gh(std::env::temp_dir())
        .with_program("flare-definitely-not-gh")
        .command(["auth", "status"])
        .run()
        .expect_err("no such program");
    assert!(matches!(error, GitError::Missing(program) if program == "flare-definitely-not-gh"));
}

#[test]
fn truncation_respects_character_boundaries() {
    let long = "é".repeat(STDERR_LIMIT);
    let cut = truncate(long);
    assert!(cut.ends_with('…'));
    assert!(cut.len() <= STDERR_LIMIT + '…'.len_utf8());
}
