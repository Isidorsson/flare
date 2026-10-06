//! Real Windows processes: a shell that starts long-lived grandchildren, and a
//! simulated Flare crash.

use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use super::probe::{report_then_crash, Helper, Watched, CRASH_CODE};
use super::ProcessTree;

const TIMEOUT: Duration = Duration::from_secs(15);
const POLL: Duration = Duration::from_millis(25);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const LONG_PING: [&str; 3] = ["-n", "60", "127.0.0.1"];
const HELPER_TEST: &str = "proctree::tests::crash_helper";
const HELPER_REPORT: &str = "FLARE_TREE_SLEEPER=";

/// Kills the root process when a test ends, however it ends. Descendants are
/// the job's business, which is what is under test.
struct Reaper(Child);

impl Reaper {
    fn id(&self) -> u32 {
        self.0.id()
    }
}

impl Drop for Reaper {
    fn drop(&mut self) {
        if let Err(error) = self.0.kill() {
            eprintln!(
                "flare test: could not stop process {}: {error}",
                self.0.id()
            );
        }
        if let Err(error) = self.0.wait() {
            eprintln!(
                "flare test: could not reap process {}: {error}",
                self.0.id()
            );
        }
    }
}

fn hidden(program: &str) -> Command {
    let mut command = Command::new(program);
    command
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn spawn_sleeper() -> Reaper {
    Reaper(hidden("ping").args(LONG_PING).spawn().expect("spawn ping"))
}

/// cmd, a background ping it detaches from, and a foreground ping: three processes.
fn spawn_forking_shell() -> Reaper {
    let script = "start /b ping -n 60 127.0.0.1 & ping -n 60 127.0.0.1";
    Reaper(
        hidden("cmd.exe")
            .args(["/c", script])
            .spawn()
            .expect("spawn cmd"),
    )
}

fn wait_for_members(tree: &ProcessTree, at_least: usize) -> Vec<Watched> {
    let deadline = Instant::now() + TIMEOUT;
    loop {
        let pids = tree.member_pids().expect("list tree members");
        if pids.len() >= at_least {
            return pids.into_iter().filter_map(Watched::open).collect();
        }
        assert!(
            Instant::now() < deadline,
            "the tree never reached {at_least} processes, saw {pids:?}"
        );
        thread::sleep(POLL);
    }
}

fn assert_all_gone(members: &[Watched]) {
    for member in members {
        assert!(
            member.wait_gone(TIMEOUT),
            "process {} survived its tree",
            member.pid()
        );
    }
}

#[test]
fn terminate_kills_every_process_in_the_tree() {
    let shell = spawn_forking_shell();
    let tree = ProcessTree::adopt(shell.id()).expect("adopt");
    let members = wait_for_members(&tree, 3);

    tree.terminate().expect("terminate");

    assert_all_gone(&members);
}

#[test]
fn dropping_the_tree_kills_every_process_in_it() {
    let shell = spawn_forking_shell();
    let tree = ProcessTree::adopt(shell.id()).expect("adopt");
    let members = wait_for_members(&tree, 3);

    drop(tree);

    assert_all_gone(&members);
}

#[test]
fn terminating_one_tree_leaves_another_alone() {
    let (first, second) = (spawn_sleeper(), spawn_sleeper());
    let first_tree = ProcessTree::adopt(first.id()).expect("adopt first");
    let _second_tree = ProcessTree::adopt(second.id()).expect("adopt second");
    let watched_first = Watched::open(first.id()).expect("first is running");
    let watched_second = Watched::open(second.id()).expect("second is running");

    first_tree.terminate().expect("terminate first");

    assert!(watched_first.wait_gone(TIMEOUT));
    assert!(watched_second.is_running());
}

#[test]
fn terminating_twice_succeeds_and_leaves_the_tree_empty() {
    let sleeper = spawn_sleeper();
    let tree = ProcessTree::adopt(sleeper.id()).expect("adopt");
    let watched = Watched::open(sleeper.id()).expect("running");

    tree.terminate().expect("first terminate");
    assert!(watched.wait_gone(TIMEOUT));
    tree.terminate()
        .expect("terminating an empty tree is a no-op");

    assert_eq!(
        tree.member_pids().expect("list tree members"),
        Vec::<u32>::new()
    );
}

#[test]
fn adopting_a_process_that_does_not_exist_fails_with_its_cause() {
    let Err(error) = ProcessTree::adopt(u32::MAX - 3) else {
        panic!("adopting a missing process must fail");
    };

    assert!(error.to_string().starts_with("failed to open the process:"));
}

/// Runs inside the helper process of `a_flare_crash_takes_the_tree_with_it`,
/// where it owns a tree until the process dies.
#[test]
#[ignore = "helper process of a_flare_crash_takes_the_tree_with_it; blocks on stdin"]
fn crash_helper() {
    let sleeper = spawn_sleeper();
    let _tree = ProcessTree::adopt(sleeper.id()).expect("adopt");
    report_then_crash(&format!("{HELPER_REPORT}{}", sleeper.id()));
}

#[test]
fn a_flare_crash_takes_the_tree_with_it() {
    let mut helper = Helper::spawn(HELPER_TEST);
    let sleeper_pid = helper
        .read_report(HELPER_REPORT)
        .parse()
        .expect("a numeric pid");
    let sleeper = Watched::open(sleeper_pid).expect("sleeper is running");

    assert_eq!(helper.crash(), Some(CRASH_CODE));

    assert!(
        sleeper.wait_gone(TIMEOUT),
        "the sleeper outlived the process that owned its tree"
    );
}
