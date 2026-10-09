//! Text that goes to a model rather than back into git: lossy decoding and length caps.

/// Git output is shown to a model, not applied, so a stray invalid byte becomes U+FFFD.
pub fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// At most `limit` characters of `text`, never cutting inside a character.
pub fn cap_chars(text: &str, limit: usize) -> &str {
    match text.char_indices().nth(limit) {
        Some((end, _)) => text[..end].trim_end(),
        None => text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_bytes_become_the_replacement_character() {
        assert_eq!(lossy(b"ok \xff ok"), "ok \u{fffd} ok");
    }

    #[test]
    fn short_text_is_kept_whole() {
        assert_eq!(cap_chars("short", 10), "short");
        assert_eq!(cap_chars("exactly ten", 11), "exactly ten");
    }

    #[test]
    fn long_text_is_cut_to_the_limit_in_characters_not_bytes() {
        let text = "é".repeat(20);
        assert_eq!(cap_chars(&text, 5), "é".repeat(5));
        assert_eq!(cap_chars("日本語のテキスト", 3), "日本語");
    }

    #[test]
    fn a_cut_does_not_leave_trailing_whitespace() {
        assert_eq!(cap_chars("word   more words", 6), "word");
    }
}
