use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use super::coalesce::Coalescer;
use super::error::PtyError;
use super::pump::{is_closed_pty, read_loop, run_emitter, Message, Sink, QUEUE_CAPACITY};
use super::shell::ShellSpec;

pub const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(50);
pub const READER_DRAIN_GRACE: Duration = Duration::from_secs(1);

const TERM_VALUE: &str = "xterm-256color";
const COLOR_TERM_VALUE: &str = "truecolor";

type SharedMaster = Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>;

pub struct SpawnConfig {
    pub shell: ShellSpec,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
}

enum Input {
    Data(Vec<u8>),
    Close,
}

struct ChildHandle {
    child: Mutex<Box<dyn Child + Send + Sync>>,
    exited: AtomicBool,
}

pub struct Session {
    id: String,
    input: Sender<Input>,
    child: Arc<ChildHandle>,
    master: SharedMaster,
    finished: Mutex<Receiver<()>>,
}

struct Wiring {
    id: String,
    reader: Box<dyn std::io::Read + Send>,
    writer: Box<dyn Write + Send>,
    child: Arc<ChildHandle>,
    master: SharedMaster,
    sink: Sink,
}

struct Waiter {
    id: String,
    child: Arc<ChildHandle>,
    master: SharedMaster,
    input: Sender<Input>,
    reader_done: Receiver<()>,
    queue: SyncSender<Message>,
    finished: Sender<()>,
}

/// A poisoned lock only means another session thread panicked (and reported it);
/// the child and master handles it guards are still valid.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

pub fn spawn_session(id: &str, config: &SpawnConfig, sink: Sink) -> Result<Session, PtyError> {
    let pair = native_pty_system()
        .openpty(pty_size(config.cols, config.rows))
        .map_err(|error| PtyError::backend("open pty", error))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| PtyError::backend("open pty reader", error))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| PtyError::backend("open pty writer", error))?;
    let child = pair
        .slave
        .spawn_command(command_for(config))
        .map_err(|error| PtyError::backend("start shell", error))?;
    drop(pair.slave);

    let child = Arc::new(ChildHandle {
        child: Mutex::new(child),
        exited: AtomicBool::new(false),
    });
    let wiring = Wiring {
        id: id.to_owned(),
        reader,
        writer,
        child: Arc::clone(&child),
        master: Arc::new(Mutex::new(Some(pair.master))),
        sink,
    };
    start_threads(wiring).inspect_err(|_| stop_child(&child))
}

fn command_for(config: &SpawnConfig) -> CommandBuilder {
    let mut command = CommandBuilder::new(&config.shell.program);
    command.args(&config.shell.args);
    command.cwd(&config.cwd);
    command.env("TERM", TERM_VALUE);
    command.env("COLORTERM", COLOR_TERM_VALUE);
    command
}

fn start_threads(wiring: Wiring) -> Result<Session, PtyError> {
    let Wiring {
        id,
        reader,
        writer,
        child,
        master,
        sink,
    } = wiring;
    let (queue_tx, queue_rx) = mpsc::sync_channel::<Message>(QUEUE_CAPACITY);
    let (input_tx, input_rx) = mpsc::channel::<Input>();
    let (reader_done_tx, reader_done_rx) = mpsc::channel::<()>();
    let (finished_tx, finished_rx) = mpsc::channel::<()>();

    let reader_queue = queue_tx.clone();
    spawn_named(&id, "read", move || {
        read_loop(reader, &reader_queue);
        drop(reader_done_tx);
    })?;

    let emit_child = Arc::clone(&child);
    spawn_named(&id, "emit", move || {
        if let Err(error) = run_emitter(&queue_rx, &*sink, Coalescer::default()) {
            eprintln!("flare pty: output stream failed, stopping the shell: {error}");
            stop_child(&emit_child);
        }
    })?;

    spawn_named(&id, "input", move || input_loop(writer, &input_rx))?;

    let waiter = Waiter {
        id: id.clone(),
        child: Arc::clone(&child),
        master: Arc::clone(&master),
        input: input_tx.clone(),
        reader_done: reader_done_rx,
        queue: queue_tx,
        finished: finished_tx,
    };
    spawn_named(&id, "wait", move || waiter.run())?;

    Ok(Session {
        id,
        input: input_tx,
        child,
        master,
        finished: Mutex::new(finished_rx),
    })
}

fn spawn_named(id: &str, role: &str, task: impl FnOnce() + Send + 'static) -> Result<(), PtyError> {
    thread::Builder::new()
        .name(format!("pty-{role}-{id}"))
        .spawn(task)
        .map(drop)
        .map_err(|error| PtyError::backend("start terminal thread", error))
}

fn input_loop(mut writer: impl Write, input: &Receiver<Input>) {
    for message in input {
        let Input::Data(bytes) = message else { return };
        if let Err(error) = writer.write_all(&bytes).and_then(|()| writer.flush()) {
            if !is_closed_pty(&error) {
                eprintln!("flare pty: write failed: {error}");
            }
            return;
        }
    }
}

fn stop_child(child: &ChildHandle) {
    if let Err(error) = child.kill() {
        eprintln!("flare pty: {error}");
    }
}

impl ChildHandle {
    fn kill(&self) -> Result<(), PtyError> {
        let mut child = lock(&self.child);
        if self.exited.load(Ordering::SeqCst) {
            return Ok(());
        }
        child
            .kill()
            .map_err(|error| PtyError::backend("stop shell", error))
    }

    fn poll_exit(&self) -> std::io::Result<Option<u32>> {
        let mut child = lock(&self.child);
        let status = child.try_wait()?;
        if status.is_some() {
            self.exited.store(true, Ordering::SeqCst);
        }
        Ok(status.map(|status| status.exit_code()))
    }
}

impl Waiter {
    fn run(self) {
        let code = self.wait_for_exit();
        // The writer thread is already gone when an earlier write failed.
        let _ = self.input.send(Input::Close);
        self.release_master();
        if self.reader_done.recv_timeout(READER_DRAIN_GRACE) == Err(RecvTimeoutError::Timeout) {
            eprintln!("flare pty: output was still open after the shell exited");
        }
        // The emitter is already gone after a sink failure, which it reported.
        let _ = self.queue.send(Message::Exit { code });
        drop(self.finished);
    }

    /// Closing a ConPTY can block forever when the shell was killed while it was
    /// still attaching to the console, so it must never hold up the exit event.
    fn release_master(&self) {
        let Some(master) = lock(&self.master).take() else {
            return;
        };
        if let Err(error) = spawn_named(&self.id, "close", move || drop(master)) {
            eprintln!("flare pty: {error}");
        }
    }

    fn wait_for_exit(&self) -> Option<u32> {
        loop {
            match self.child.poll_exit() {
                Ok(Some(code)) => return Some(code),
                Ok(None) => thread::sleep(EXIT_POLL_INTERVAL),
                Err(error) => {
                    eprintln!("flare pty: checking the shell failed: {error}");
                    self.child.exited.store(true, Ordering::SeqCst);
                    return None;
                }
            }
        }
    }
}

impl Session {
    pub fn write(&self, data: Vec<u8>) -> Result<(), PtyError> {
        self.input
            .send(Input::Data(data))
            .map_err(|_| PtyError::Exited(self.id.clone()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
        let guard = lock(&self.master);
        let master = guard
            .as_ref()
            .ok_or_else(|| PtyError::Exited(self.id.clone()))?;
        master
            .resize(pty_size(cols, rows))
            .map_err(|error| PtyError::backend("resize terminal", error))
    }

    pub fn kill(&self) -> Result<(), PtyError> {
        self.child.kill()
    }

    pub fn wait_finished(&self, timeout: Duration) -> bool {
        lock(&self.finished).recv_timeout(timeout) == Err(RecvTimeoutError::Disconnected)
    }
}
