use std::fmt;

pub const MAX_LINE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum FramingError {
    InvalidUtf8,
    LineTooLong,
}

impl fmt::Display for FramingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUtf8 => write!(f, "the bridge wrote a line that is not valid UTF-8"),
            Self::LineTooLong => write!(
                f,
                "the bridge wrote a line longer than {MAX_LINE_BYTES} bytes"
            ),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum OutgoingError {
    Empty,
    EmbeddedNewline,
}

impl fmt::Display for OutgoingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "refusing to send an empty line to the bridge"),
            Self::EmbeddedNewline => write!(f, "a bridge message must be a single line"),
        }
    }
}

/// Splits raw stdout chunks into NDJSON lines. Chunk boundaries are arbitrary, so
/// a line (and a multi-byte character inside it) may arrive in several pieces.
#[derive(Debug, Default)]
pub struct LineFramer {
    buffer: Vec<u8>,
    discarding: bool,
}

impl LineFramer {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<Result<String, FramingError>> {
        let mut lines = Vec::new();
        for segment in chunk.split_inclusive(|byte| *byte == b'\n') {
            let complete = segment.ends_with(b"\n");
            if self.discarding {
                self.discarding = !complete;
                continue;
            }
            self.buffer.extend_from_slice(segment);
            if self.buffer.len() > MAX_LINE_BYTES {
                self.buffer.clear();
                self.discarding = !complete;
                lines.push(Err(FramingError::LineTooLong));
            } else if complete {
                lines.extend(self.take_line());
            }
        }
        lines
    }

    /// Flushes a trailing line that was never terminated, for when the bridge exits.
    pub fn finish(&mut self) -> Option<Result<String, FramingError>> {
        if std::mem::take(&mut self.discarding) {
            self.buffer.clear();
            return None;
        }
        self.take_line()
    }

    fn take_line(&mut self) -> Option<Result<String, FramingError>> {
        let bytes = std::mem::take(&mut self.buffer);
        let line = trim_line_end(&bytes);
        if line.is_empty() {
            return None;
        }
        Some(String::from_utf8(line.to_vec()).map_err(|_| FramingError::InvalidUtf8))
    }
}

/// Frames one app-to-bridge message: exactly one line terminated by a single newline.
pub fn frame_outgoing(line: &str) -> Result<Vec<u8>, OutgoingError> {
    let body = line.trim_end_matches(['\r', '\n']);
    if body.is_empty() {
        return Err(OutgoingError::Empty);
    }
    if body.contains(['\r', '\n']) {
        return Err(OutgoingError::EmbeddedNewline);
    }
    let mut framed = Vec::with_capacity(body.len() + 1);
    framed.extend_from_slice(body.as_bytes());
    framed.push(b'\n');
    Ok(framed)
}

fn trim_line_end(bytes: &[u8]) -> &[u8] {
    let without_newline = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    without_newline
        .strip_suffix(b"\r")
        .unwrap_or(without_newline)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(line: &str) -> Result<String, FramingError> {
        Ok(line.to_owned())
    }

    #[test]
    fn splits_complete_lines_in_one_chunk() {
        let mut framer = LineFramer::default();
        assert_eq!(
            framer.push(b"{\"a\":1}\n{\"b\":2}\n"),
            vec![ok("{\"a\":1}"), ok("{\"b\":2}")]
        );
    }

    #[test]
    fn keeps_a_partial_line_until_its_newline_arrives() {
        let mut framer = LineFramer::default();
        assert!(framer.push(b"{\"type\":\"ass").is_empty());
        assert!(framer.push(b"istant.delta\"").is_empty());
        assert_eq!(
            framer.push(b"}\n"),
            vec![ok("{\"type\":\"assistant.delta\"}")]
        );
    }

    #[test]
    fn handles_a_chunk_that_ends_mid_line_after_complete_lines() {
        let mut framer = LineFramer::default();
        assert_eq!(framer.push(b"one\ntw"), vec![ok("one")]);
        assert_eq!(framer.push(b"o\nthree"), vec![ok("two")]);
        assert_eq!(framer.finish(), Some(ok("three")));
    }

    #[test]
    fn reassembles_a_multibyte_character_split_across_chunks() {
        let mut framer = LineFramer::default();
        let bytes = "h\u{e9}llo \u{1f525}\n".as_bytes();
        let (head, tail) = bytes.split_at(2);
        assert!(framer.push(head).is_empty());
        assert_eq!(framer.push(tail), vec![ok("h\u{e9}llo \u{1f525}")]);
    }

    #[test]
    fn strips_carriage_returns_and_skips_blank_lines() {
        let mut framer = LineFramer::default();
        assert_eq!(framer.push(b"a\r\n\r\n\nb\r\n"), vec![ok("a"), ok("b")]);
    }

    #[test]
    fn reports_invalid_utf8_without_losing_the_following_lines() {
        let mut framer = LineFramer::default();
        let lines = framer.push(b"\xff\xfe\nok\n");
        assert_eq!(lines, vec![Err(FramingError::InvalidUtf8), ok("ok")]);
    }

    #[test]
    fn finish_returns_nothing_when_the_stream_ended_on_a_newline() {
        let mut framer = LineFramer::default();
        framer.push(b"done\n");
        assert_eq!(framer.finish(), None);
    }

    #[test]
    fn rejects_an_overlong_line_and_resynchronises_on_the_next_one() {
        let mut framer = LineFramer::default();
        let long = vec![b'x'; MAX_LINE_BYTES + 1];
        assert_eq!(framer.push(&long), vec![Err(FramingError::LineTooLong)]);
        assert!(framer.push(b"still the same line").is_empty());
        assert_eq!(framer.push(b" ends here\nnext\n"), vec![ok("next")]);
    }

    #[test]
    fn an_overlong_line_that_ends_in_the_same_chunk_does_not_swallow_the_next_line() {
        let mut framer = LineFramer::default();
        let mut chunk = vec![b'x'; MAX_LINE_BYTES + 1];
        chunk.extend_from_slice(b"\nnext\n");
        assert_eq!(
            framer.push(&chunk),
            vec![Err(FramingError::LineTooLong), ok("next")]
        );
    }

    #[test]
    fn finish_drops_the_tail_of_a_discarded_line() {
        let mut framer = LineFramer::default();
        framer.push(&vec![b'x'; MAX_LINE_BYTES + 1]);
        assert_eq!(framer.finish(), None);
        assert_eq!(framer.push(b"fresh\n"), vec![ok("fresh")]);
    }

    #[test]
    fn frames_an_outgoing_line_with_exactly_one_newline() {
        assert_eq!(
            frame_outgoing("{\"type\":\"interrupt\"}"),
            Ok(b"{\"type\":\"interrupt\"}\n".to_vec())
        );
        assert_eq!(
            frame_outgoing("{\"type\":\"interrupt\"}\r\n\n"),
            Ok(b"{\"type\":\"interrupt\"}\n".to_vec())
        );
    }

    #[test]
    fn refuses_empty_outgoing_lines() {
        assert_eq!(frame_outgoing(""), Err(OutgoingError::Empty));
        assert_eq!(frame_outgoing("\r\n"), Err(OutgoingError::Empty));
    }

    #[test]
    fn refuses_outgoing_lines_with_embedded_newlines() {
        assert_eq!(
            frame_outgoing("{\"a\":\n1}"),
            Err(OutgoingError::EmbeddedNewline)
        );
        assert_eq!(frame_outgoing("a\rb"), Err(OutgoingError::EmbeddedNewline));
    }
}
