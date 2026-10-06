use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};

use super::coalesce::{classify, Coalescer};
use super::error::FsError;
use super::hub::{ChangeKind, FsChange, WatchBatch, WatchHub};
use super::ignore_rules::IgnoreMatcher;
use super::io::is_temp_file_name;
use super::sandbox::{to_wire, GIT_DIR};

pub const DEBOUNCE: Duration = Duration::from_millis(80);
pub const MAX_BATCH_WINDOW: Duration = Duration::from_millis(600);
const GITIGNORE_FILE: &str = ".gitignore";

type RawEvent = notify::Result<Event>;

#[derive(Clone)]
pub struct WatchContext {
    pub root: PathBuf,
    pub matcher: Arc<IgnoreMatcher>,
    pub hub: WatchHub,
}

/// Dropping this stops the OS watcher, which closes the event channel and
/// lets the debounce thread flush what is left and exit.
pub struct WorkspaceWatcher {
    _watcher: RecommendedWatcher,
}

pub fn start(ctx: WatchContext) -> Result<WorkspaceWatcher, FsError> {
    let (sender, receiver) = mpsc::channel::<RawEvent>();
    let mut watcher = notify::recommended_watcher(move |event: RawEvent| {
        // A closed channel means the debounce thread already shut down.
        let _ = sender.send(event);
    })?;
    watcher.watch(&ctx.root, RecursiveMode::Recursive)?;
    let root = ctx.root.clone();
    thread::Builder::new()
        .name("flare-fs-watch".to_owned())
        .spawn(move || run_debouncer(&receiver, &ctx))
        .map_err(|e| FsError::io(&root, e))?;
    Ok(WorkspaceWatcher { _watcher: watcher })
}

fn run_debouncer(receiver: &Receiver<RawEvent>, ctx: &WatchContext) {
    let mut coalescer = Coalescer::default();
    let mut window_start = Instant::now();
    loop {
        let next = if coalescer.is_empty() {
            receiver.recv().map_err(|_| RecvTimeoutError::Disconnected)
        } else {
            receiver.recv_timeout(DEBOUNCE)
        };
        match next {
            Ok(event) => {
                if coalescer.is_empty() {
                    window_start = Instant::now();
                }
                ingest(ctx, &mut coalescer, event);
                if window_start.elapsed() >= MAX_BATCH_WINDOW {
                    flush(ctx, &mut coalescer);
                }
            }
            Err(RecvTimeoutError::Timeout) => flush(ctx, &mut coalescer),
            Err(RecvTimeoutError::Disconnected) => {
                flush(ctx, &mut coalescer);
                return;
            }
        }
    }
}

fn ingest(ctx: &WatchContext, coalescer: &mut Coalescer, event: RawEvent) {
    let event = match event {
        Ok(event) => event,
        Err(error) => {
            eprintln!("flare: file watcher error, requesting a rescan: {error}");
            coalescer.request_rescan();
            return;
        }
    };
    if event.need_rescan() {
        coalescer.request_rescan();
    }
    for (path, kind) in classify(&event) {
        if is_watchable(&ctx.root, &path) {
            if path.file_name().is_some_and(|name| name == GITIGNORE_FILE) {
                ctx.matcher.invalidate();
            }
            coalescer.push(path, kind);
        }
    }
}

fn is_watchable(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let in_git_dir = relative.components().any(|c| c.as_os_str() == GIT_DIR);
    let is_temp = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(is_temp_file_name);
    !in_git_dir && !is_temp
}

fn flush(ctx: &WatchContext, coalescer: &mut Coalescer) {
    let (pending, rescan) = coalescer.drain();
    let changes: Vec<FsChange> = pending
        .into_iter()
        .filter_map(|(path, kind)| visible_change(&ctx.matcher, &path, kind))
        .collect();
    if changes.is_empty() && !rescan {
        return;
    }
    ctx.hub.publish(WatchBatch {
        root: to_wire(&ctx.root),
        changes,
        rescan,
    });
}

fn visible_change(matcher: &IgnoreMatcher, path: &Path, kind: ChangeKind) -> Option<FsChange> {
    let is_dir = kind != ChangeKind::Remove && path.is_dir();
    let directory_touch = kind == ChangeKind::Modify && is_dir;
    if directory_touch || matcher.is_ignored(path, is_dir) {
        return None;
    }
    Some(FsChange {
        path: to_wire(path),
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc::Receiver;

    const WAIT: Duration = Duration::from_secs(15);

    struct Harness {
        _dir: tempfile::TempDir,
        root: PathBuf,
        _watcher: WorkspaceWatcher,
        events: Receiver<Arc<WatchBatch>>,
    }

    fn harness(gitignore: &str) -> Harness {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        fs::create_dir_all(root.join(".git")).expect("git dir");
        fs::write(root.join(".gitignore"), gitignore).expect("gitignore");
        let hub = WatchHub::default();
        let (_, events) = hub.subscribe();
        let matcher = Arc::new(IgnoreMatcher::new(&root));
        let watcher = start(WatchContext {
            root: root.clone(),
            matcher,
            hub,
        })
        .expect("start");
        Harness {
            _dir: dir,
            root,
            _watcher: watcher,
            events,
        }
    }

    fn wire(root: &Path, relative: &str) -> String {
        to_wire(&root.join(relative))
    }

    fn collect_until(events: &Receiver<Arc<WatchBatch>>, wanted: &str) -> Vec<FsChange> {
        let deadline = Instant::now() + WAIT;
        let mut seen = Vec::new();
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let Ok(batch) = events.recv_timeout(remaining) else {
                break;
            };
            seen.extend(batch.changes.iter().cloned());
            if seen.iter().any(|c| c.path == wanted) {
                return seen;
            }
        }
        panic!("no event for {wanted} within {WAIT:?}; saw {seen:?}");
    }

    /// Filesystem events arrive in order, so once the marker shows up every
    /// earlier change has been delivered too.
    fn changes_until_marker(h: &Harness, marker: &str) -> Vec<FsChange> {
        fs::write(h.root.join(marker), "m").expect("marker");
        collect_until(&h.events, &wire(&h.root, marker))
    }

    #[test]
    fn reports_created_files() {
        let h = harness("");
        fs::write(h.root.join("new.txt"), "hello").expect("write");
        let seen = changes_until_marker(&h, "marker.txt");
        let target = wire(&h.root, "new.txt");
        assert!(
            seen.iter()
                .any(|c| c.path == target && c.kind != ChangeKind::Remove),
            "{seen:?}"
        );
    }

    #[test]
    fn reports_removed_files() {
        let h = harness("");
        fs::write(h.root.join("gone.txt"), "x").expect("write");
        changes_until_marker(&h, "marker-1.txt");
        fs::remove_file(h.root.join("gone.txt")).expect("remove");
        let seen = changes_until_marker(&h, "marker-2.txt");
        let target = wire(&h.root, "gone.txt");
        let last = seen
            .iter()
            .rfind(|c| c.path == target)
            .expect("event for removed file");
        assert_eq!(last.kind, ChangeKind::Remove);
    }

    #[test]
    fn never_reports_gitignored_paths_or_the_git_directory() {
        let h = harness(
            "ignored/
*.log
",
        );
        fs::create_dir_all(h.root.join("ignored")).expect("mkdir");
        fs::write(h.root.join("ignored/a.txt"), "x").expect("write");
        fs::write(h.root.join("debug.log"), "x").expect("write");
        fs::write(h.root.join(".git/HEAD"), "ref").expect("write");
        fs::write(h.root.join("visible.txt"), "x").expect("write");
        let seen = changes_until_marker(&h, "marker.txt");
        let visible = wire(&h.root, "visible.txt");
        assert!(seen.iter().any(|c| c.path == visible), "{seen:?}");
        for change in &seen {
            let path = &change.path;
            assert!(!path.contains("/ignored"), "{path}");
            assert!(!path.ends_with(".log"), "{path}");
            assert!(!path.contains("/.git/"), "{path}");
        }
    }

    #[test]
    fn atomic_writes_surface_only_the_target_file() {
        let h = harness("");
        let target = h.root.join("saved.txt");
        fs::write(&target, "v1").expect("write");
        changes_until_marker(&h, "marker-1.txt");
        super::super::io::write_atomic(&target, "v2").expect("atomic write");
        let seen = changes_until_marker(&h, "marker-2.txt");
        let wired = wire(&h.root, "saved.txt");
        assert!(seen.iter().any(|c| c.path == wired), "{seen:?}");
        assert!(seen.iter().all(|c| !c.path.contains(".flare-")), "{seen:?}");
    }

    #[test]
    fn debouncer_flushes_pending_work_when_the_watcher_stops() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        let hub = WatchHub::default();
        let (_, events) = hub.subscribe();
        let matcher = Arc::new(IgnoreMatcher::new(&root));
        let ctx = WatchContext {
            root: root.clone(),
            matcher,
            hub,
        };
        let (sender, receiver) = mpsc::channel::<RawEvent>();
        let worker = thread::spawn(move || run_debouncer(&receiver, &ctx));
        let file = root.join("late.txt");
        fs::write(&file, "x").expect("write");
        let event =
            Event::new(notify::EventKind::Modify(notify::event::ModifyKind::Any)).add_path(file);
        sender.send(Ok(event)).expect("send");
        drop(sender);
        worker.join().expect("debouncer exits");
        let batch = events.try_recv().expect("flushed batch");
        assert_eq!(batch.changes.len(), 1);
        assert_eq!(batch.changes[0].path, wire(&root, "late.txt"));
    }

    #[test]
    fn watcher_errors_request_a_rescan() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dunce::canonicalize(dir.path()).expect("canonical");
        let hub = WatchHub::default();
        let (_, events) = hub.subscribe();
        let matcher = Arc::new(IgnoreMatcher::new(&root));
        let ctx = WatchContext { root, matcher, hub };
        let (sender, receiver) = mpsc::channel::<RawEvent>();
        let worker = thread::spawn(move || run_debouncer(&receiver, &ctx));
        sender
            .send(Err(notify::Error::generic("boom")))
            .expect("send");
        drop(sender);
        worker.join().expect("debouncer exits");
        let batch = events.try_recv().expect("rescan batch");
        assert!(batch.rescan);
        assert!(batch.changes.is_empty());
    }

    #[test]
    fn watchable_paths_exclude_git_and_temp_files() {
        let root = Path::new("/ws");
        assert!(is_watchable(root, Path::new("/ws/src/a.ts")));
        assert!(!is_watchable(root, Path::new("/ws/.git/index")));
        assert!(!is_watchable(root, Path::new("/ws/src/.flare-x1y2.tmp")));
        assert!(!is_watchable(root, Path::new("/elsewhere/a.ts")));
    }
}
