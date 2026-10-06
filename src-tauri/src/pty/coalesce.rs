use std::time::{Duration, Instant};

pub const COALESCE_INTERVAL: Duration = Duration::from_millis(8);
pub const COALESCE_MAX_BYTES: usize = 64 * 1024;

/// Throttles PTY output into frames: the first chunk after a quiet period goes
/// out immediately (typing stays responsive), later chunks are merged until the
/// interval elapses or the size cap is hit. `max_bytes` is a soft cap: a frame
/// can exceed it by the last chunk that crossed it.
pub struct Coalescer {
    interval: Duration,
    max_bytes: usize,
    pending: Vec<u8>,
    last_flush: Option<Instant>,
}

impl Default for Coalescer {
    fn default() -> Self {
        Self::new(COALESCE_INTERVAL, COALESCE_MAX_BYTES)
    }
}

impl Coalescer {
    pub fn new(interval: Duration, max_bytes: usize) -> Self {
        Self {
            interval,
            max_bytes,
            pending: Vec::new(),
            last_flush: None,
        }
    }

    pub fn push(&mut self, chunk: &[u8], now: Instant) -> Option<Vec<u8>> {
        self.pending.extend_from_slice(chunk);
        if self.pending.len() >= self.max_bytes || self.interval_elapsed(now) {
            return self.take(now);
        }
        None
    }

    pub fn deadline(&self) -> Option<Instant> {
        if self.pending.is_empty() {
            return None;
        }
        self.last_flush.map(|flushed| flushed + self.interval)
    }

    pub fn poll(&mut self, now: Instant) -> Option<Vec<u8>> {
        match self.deadline() {
            Some(deadline) if now >= deadline => self.take(now),
            _ => None,
        }
    }

    pub fn finish(&mut self, now: Instant) -> Option<Vec<u8>> {
        self.take(now)
    }

    fn interval_elapsed(&self, now: Instant) -> bool {
        self.last_flush
            .is_none_or(|flushed| now.saturating_duration_since(flushed) >= self.interval)
    }

    fn take(&mut self, now: Instant) -> Option<Vec<u8>> {
        if self.pending.is_empty() {
            return None;
        }
        self.last_flush = Some(now);
        Some(std::mem::take(&mut self.pending))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INTERVAL: Duration = Duration::from_millis(10);

    fn coalescer(max_bytes: usize) -> (Coalescer, Instant) {
        (Coalescer::new(INTERVAL, max_bytes), Instant::now())
    }

    fn after(base: Instant, millis: u64) -> Instant {
        base + Duration::from_millis(millis)
    }

    #[test]
    fn first_chunk_is_flushed_immediately() {
        let (mut c, t0) = coalescer(1024);
        assert_eq!(c.push(b"a", t0), Some(b"a".to_vec()));
        assert_eq!(c.deadline(), None);
    }

    #[test]
    fn chunks_inside_the_interval_are_held_until_the_deadline() {
        let (mut c, t0) = coalescer(1024);
        c.push(b"a", t0);

        assert_eq!(c.push(b"b", after(t0, 2)), None);
        assert_eq!(c.push(b"c", after(t0, 4)), None);
        assert_eq!(c.deadline(), Some(after(t0, 10)));

        assert_eq!(c.poll(after(t0, 9)), None);
        assert_eq!(c.poll(after(t0, 10)), Some(b"bc".to_vec()));
        assert_eq!(c.deadline(), None);
    }

    #[test]
    fn a_chunk_after_a_quiet_period_is_flushed_immediately() {
        let (mut c, t0) = coalescer(1024);
        c.push(b"a", t0);

        assert_eq!(c.push(b"b", after(t0, 50)), Some(b"b".to_vec()));
    }

    #[test]
    fn reaching_the_size_cap_flushes_inside_the_interval() {
        let (mut c, t0) = coalescer(4);
        c.push(b"a", t0);

        assert_eq!(c.push(b"bc", after(t0, 1)), None);
        assert_eq!(c.push(b"de", after(t0, 2)), Some(b"bcde".to_vec()));
    }

    #[test]
    fn finish_drains_pending_bytes_regardless_of_the_deadline() {
        let (mut c, t0) = coalescer(1024);
        c.push(b"a", t0);
        c.push(b"b", after(t0, 1));

        assert_eq!(c.finish(after(t0, 2)), Some(b"b".to_vec()));
        assert_eq!(c.finish(after(t0, 3)), None);
    }

    #[test]
    fn empty_chunks_never_produce_frames() {
        let (mut c, t0) = coalescer(1024);

        assert_eq!(c.push(b"", t0), None);
        assert_eq!(c.deadline(), None);
        assert_eq!(c.poll(after(t0, 100)), None);
    }

    #[test]
    fn frames_preserve_byte_order_across_many_chunks() {
        let (mut c, t0) = coalescer(1024);
        let mut out = Vec::new();
        for (i, byte) in (b'a'..=b'j').enumerate() {
            out.extend(c.push(&[byte], after(t0, i as u64)).unwrap_or_default());
        }
        out.extend(c.finish(after(t0, 20)).unwrap_or_default());

        assert_eq!(out, b"abcdefghij".to_vec());
    }
}
