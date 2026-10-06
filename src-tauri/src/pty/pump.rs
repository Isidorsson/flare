use std::io::{ErrorKind, Read};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender};
use std::sync::Arc;
use std::time::Instant;

use super::coalesce::Coalescer;

pub const READ_BUFFER_BYTES: usize = 16 * 1024;
pub const QUEUE_CAPACITY: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyEvent {
    Output(Vec<u8>),
    Exit { code: Option<u32> },
}

pub type SinkResult = Result<(), String>;
pub type Sink = Arc<dyn Fn(PtyEvent) -> SinkResult + Send + Sync>;

pub enum Message {
    Data(Vec<u8>),
    Exit { code: Option<u32> },
}

pub fn read_loop(mut reader: impl Read, queue: &SyncSender<Message>) {
    let mut buffer = vec![0u8; READ_BUFFER_BYTES];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return,
            Ok(read) => {
                if queue.send(Message::Data(buffer[..read].to_vec())).is_err() {
                    return;
                }
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => {}
            Err(error) => {
                if !is_closed_pty(&error) {
                    eprintln!("flare pty: read failed: {error}");
                }
                return;
            }
        }
    }
}

/// Reading a pty master after its child exits fails with BrokenPipe on Windows
/// and EIO on Unix; both just mean the stream ended.
pub(super) fn is_closed_pty(error: &std::io::Error) -> bool {
    const EIO: i32 = 5;
    error.kind() == ErrorKind::BrokenPipe || (cfg!(unix) && error.raw_os_error() == Some(EIO))
}

pub fn run_emitter(
    queue: &Receiver<Message>,
    sink: &dyn Fn(PtyEvent) -> SinkResult,
    mut coalescer: Coalescer,
) -> SinkResult {
    loop {
        let next = match coalescer.deadline() {
            Some(deadline) => {
                queue.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            }
            None => queue.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        let now = Instant::now();
        match next {
            Ok(Message::Data(bytes)) => emit_output(sink, coalescer.push(&bytes, now))?,
            Ok(Message::Exit { code }) => {
                emit_output(sink, coalescer.finish(now))?;
                return sink(PtyEvent::Exit { code });
            }
            Err(RecvTimeoutError::Timeout) => emit_output(sink, coalescer.poll(now))?,
            Err(RecvTimeoutError::Disconnected) => {
                return emit_output(sink, coalescer.finish(now));
            }
        }
    }
}

fn emit_output(sink: &dyn Fn(PtyEvent) -> SinkResult, frame: Option<Vec<u8>>) -> SinkResult {
    frame.map_or(Ok(()), |bytes| sink(PtyEvent::Output(bytes)))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;
    use std::sync::mpsc;
    use std::sync::Mutex;
    use std::time::Duration;

    use super::*;

    type Recorded = Arc<Mutex<Vec<PtyEvent>>>;

    fn recording_sink() -> (Recorded, impl Fn(PtyEvent) -> SinkResult) {
        let events: Recorded = Arc::default();
        let log = Arc::clone(&events);
        (events, move |event| {
            log.lock().unwrap().push(event);
            Ok(())
        })
    }

    fn output_bytes(events: &[PtyEvent]) -> Vec<u8> {
        events
            .iter()
            .filter_map(|event| match event {
                PtyEvent::Output(bytes) => Some(bytes.clone()),
                PtyEvent::Exit { .. } => None,
            })
            .flatten()
            .collect()
    }

    #[test]
    fn emits_all_output_in_order_and_exit_last() {
        let (tx, rx) = mpsc::sync_channel(8);
        for chunk in [&b"hel"[..], b"lo ", b"world"] {
            tx.send(Message::Data(chunk.to_vec())).unwrap();
        }
        tx.send(Message::Exit { code: Some(3) }).unwrap();
        let (events, sink) = recording_sink();

        run_emitter(&rx, &sink, Coalescer::default()).unwrap();

        let events = events.lock().unwrap();
        assert_eq!(output_bytes(&events), b"hello world".to_vec());
        assert_eq!(events.last(), Some(&PtyEvent::Exit { code: Some(3) }));
    }

    #[test]
    fn flushes_pending_output_when_the_queue_disconnects() {
        let (tx, rx) = mpsc::sync_channel(8);
        tx.send(Message::Data(b"a".to_vec())).unwrap();
        tx.send(Message::Data(b"b".to_vec())).unwrap();
        drop(tx);
        let (events, sink) = recording_sink();

        run_emitter(&rx, &sink, Coalescer::default()).unwrap();

        let events = events.lock().unwrap();
        assert_eq!(output_bytes(&events), b"ab".to_vec());
        assert!(events
            .iter()
            .all(|event| matches!(event, PtyEvent::Output(_))));
    }

    #[test]
    fn trailing_output_is_flushed_by_the_interval_timer() {
        let (tx, rx) = mpsc::sync_channel(8);
        let interval = Duration::from_millis(20);
        let coalescer = Coalescer::new(interval, 1024);
        let (events, sink) = recording_sink();
        let worker = std::thread::spawn(move || run_emitter(&rx, &sink, coalescer));

        tx.send(Message::Data(b"a".to_vec())).unwrap();
        tx.send(Message::Data(b"b".to_vec())).unwrap();
        std::thread::sleep(interval * 8);
        let seen = output_bytes(&events.lock().unwrap());
        drop(tx);
        worker.join().unwrap().unwrap();

        assert_eq!(seen, b"ab".to_vec());
    }

    #[test]
    fn propagates_a_sink_failure() {
        let (tx, rx) = mpsc::sync_channel(8);
        tx.send(Message::Data(b"a".to_vec())).unwrap();
        let sink = |_: PtyEvent| -> SinkResult { Err("webview gone".into()) };

        let error = run_emitter(&rx, &sink, Coalescer::default()).unwrap_err();

        assert_eq!(error, "webview gone");
    }

    #[test]
    fn read_loop_forwards_chunks_until_eof() {
        let (tx, rx) = mpsc::sync_channel(QUEUE_CAPACITY);
        let data = vec![7u8; READ_BUFFER_BYTES * 2 + 5];

        read_loop(Cursor::new(data.clone()), &tx);
        drop(tx);

        let received: Vec<u8> = rx
            .iter()
            .flat_map(|message| match message {
                Message::Data(bytes) => bytes,
                Message::Exit { .. } => Vec::new(),
            })
            .collect();
        assert_eq!(received, data);
    }

    #[test]
    fn read_loop_stops_when_the_emitter_is_gone() {
        let (tx, rx) = mpsc::sync_channel(1);
        drop(rx);

        read_loop(Cursor::new(vec![1u8; 10]), &tx);
    }
}
