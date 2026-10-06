use super::RawImport;

const IMPORT_RULES: [&str; 3] = ["import", "use", "forward"];
const URL_FUNCTION: &str = "url";

/// CSS, SCSS and Less share `@import`; SCSS adds `@use` and `@forward`. The
/// tree-sitter CSS grammar rejects `@use` and the SCSS/Less grammar crates do
/// not build with MSVC, so one comment- and string-aware scanner serves all three.
pub(super) fn extract(source: &[u8]) -> Vec<RawImport> {
    let mut scanner = Scanner { source, pos: 0 };
    let mut imports = Vec::new();
    while let Some(byte) = scanner.peek() {
        if scanner.at_comment() {
            scanner.skip_comment();
            continue;
        }
        match byte {
            b'"' | b'\'' => {
                scanner.read_string();
            }
            b'@' => {
                scanner.pos += 1;
                if IMPORT_RULES.contains(&scanner.word()) {
                    scanner.read_prelude(&mut imports);
                }
            }
            byte if is_word_byte(byte) => {
                scanner.word_url();
            }
            _ => scanner.pos += 1,
        }
    }
    imports
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}

struct Scanner<'a> {
    source: &'a [u8],
    pos: usize,
}

impl<'a> Scanner<'a> {
    fn peek(&self) -> Option<u8> {
        self.source.get(self.pos).copied()
    }

    fn at_comment(&self) -> bool {
        self.peek() == Some(b'/') && matches!(self.source.get(self.pos + 1), Some(b'*' | b'/'))
    }

    fn skip_comment(&mut self) {
        let block = self.source.get(self.pos + 1) == Some(&b'*');
        self.pos += 2;
        while let Some(byte) = self.peek() {
            let closes = block && byte == b'*' && self.source.get(self.pos + 1) == Some(&b'/');
            if closes {
                self.pos += 2;
                return;
            }
            if !block && byte == b'\n' {
                return;
            }
            self.pos += 1;
        }
    }

    fn word(&mut self) -> &'a str {
        let start = self.pos;
        while self.peek().is_some_and(is_word_byte) {
            self.pos += 1;
        }
        std::str::from_utf8(&self.source[start..self.pos]).unwrap_or("")
    }

    fn read_string(&mut self) -> String {
        let quote = self.peek();
        self.pos += 1;
        let start = self.pos;
        while let Some(byte) = self.peek() {
            if Some(byte) == quote || byte == b'\n' {
                break;
            }
            self.pos += if byte == b'\\' { 2 } else { 1 };
        }
        let end = self.pos.min(self.source.len());
        if self.peek() == quote {
            self.pos += 1;
        }
        String::from_utf8_lossy(&self.source[start..end.max(start)]).into_owned()
    }

    /// Consumes one word; when it is a `url(` call, consumes the call and returns its target.
    fn word_url(&mut self) -> Option<String> {
        let is_url = self.word().eq_ignore_ascii_case(URL_FUNCTION);
        if is_url && self.peek() == Some(b'(') {
            self.read_url()
        } else {
            None
        }
    }

    fn read_url(&mut self) -> Option<String> {
        self.pos += 1;
        self.skip_spaces();
        let path = match self.peek() {
            Some(b'"' | b'\'') => self.read_string(),
            _ => self.read_until_close_paren(),
        };
        while self.peek().is_some_and(|byte| byte != b')') {
            self.pos += 1;
        }
        self.pos = (self.pos + 1).min(self.source.len());
        let trimmed = path.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    }

    fn read_until_close_paren(&mut self) -> String {
        let start = self.pos;
        while self.peek().is_some_and(|byte| byte != b')') {
            self.pos += 1;
        }
        String::from_utf8_lossy(&self.source[start..self.pos]).into_owned()
    }

    fn skip_spaces(&mut self) {
        while self.peek().is_some_and(|byte| byte.is_ascii_whitespace()) {
            self.pos += 1;
        }
    }

    fn skip_group(&mut self) {
        let mut depth = 0usize;
        while let Some(byte) = self.peek() {
            if self.at_comment() {
                self.skip_comment();
                continue;
            }
            match byte {
                b'"' | b'\'' => {
                    self.read_string();
                    continue;
                }
                b'(' => depth += 1,
                b')' => depth = depth.saturating_sub(1),
                _ => {}
            }
            self.pos += 1;
            if depth == 0 {
                return;
            }
        }
    }

    fn read_prelude(&mut self, imports: &mut Vec<RawImport>) {
        while let Some(byte) = self.peek() {
            if self.at_comment() {
                self.skip_comment();
                continue;
            }
            match byte {
                b';' | b'{' | b'}' => return,
                b'"' | b'\'' => {
                    let path = self.read_string();
                    imports.push(RawImport::StyleImport { path });
                }
                b'(' => self.skip_group(),
                byte if is_word_byte(byte) => {
                    if let Some(path) = self.word_url() {
                        imports.push(RawImport::StyleImport { path });
                    }
                }
                _ => self.pos += 1,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(source: &str) -> Vec<String> {
        extract(source.as_bytes())
            .into_iter()
            .map(|import| match import {
                RawImport::StyleImport { path } => path,
                other => panic!("unexpected import {other:?}"),
            })
            .collect()
    }

    #[test]
    fn finds_css_imports_in_string_and_url_form() {
        let source = "@import \"a.css\";\n@import url(\"b.css\");\n@import url(c.css) screen;\n@import 'd.css' layer(x) supports(display: grid);\n";
        assert_eq!(paths(source), ["a.css", "b.css", "c.css", "d.css"]);
    }

    #[test]
    fn finds_scss_use_forward_and_comma_separated_imports() {
        let source = "@use \"a\";\n@use 'b' as c;\n@forward \"d\" show x;\n@import \"e\", 'f';\n@use \"g\" with ($k: \"v\", $m: (a: \"w\"));\n";
        assert_eq!(paths(source), ["a", "b", "d", "e", "f", "g"]);
    }

    #[test]
    fn finds_less_imports_with_option_lists() {
        let source =
            "@import (reference) \"a.less\";\n@import (css, optional) url(b.css);\n@color: red;\n";
        assert_eq!(paths(source), ["a.less", "b.css"]);
    }

    #[test]
    fn ignores_comments_strings_and_unrelated_at_rules() {
        let source = "/* @import 'block'; */\n// @import 'line';\n.a { content: \"@import 'str';\"; background: url(//cdn/x.png); }\n@media screen { .b { color: red } }\n@import 'real';\n";
        assert_eq!(paths(source), ["real"]);
    }

    #[test]
    fn imports_nested_in_rules_are_found() {
        assert_eq!(paths(".a { @import \"nested\"; }\n"), ["nested"]);
    }

    #[test]
    fn tolerates_unterminated_input() {
        assert_eq!(paths("@import \"a"), ["a"]);
        assert!(paths("@import").is_empty());
        assert!(paths("/* never closed @import 'x'").is_empty());
        assert_eq!(paths("@import url(open"), ["open"]);
    }

    #[test]
    fn non_ascii_text_does_not_break_the_scanner() {
        assert_eq!(
            paths(".é { content: \"ü\"; }\n@import \"ä.css\";\n"),
            ["ä.css"]
        );
    }
}
