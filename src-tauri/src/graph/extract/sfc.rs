use std::ops::Range;

use crate::graph::lang::SourceKind;

const SCRIPT_TAG: &[u8] = b"<script";
const SCRIPT_CLOSE: &[u8] = b"</script";
const COMMENT_OPEN: &[u8] = b"<!--";
const COMMENT_CLOSE: &[u8] = b"-->";

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ScriptBlock {
    pub kind: SourceKind,
    pub range: Range<usize>,
}

/// Finds the `<script>` bodies of a Vue or Svelte component. The component
/// grammar crates are unmaintained against tree-sitter 0.26, and only the
/// script bodies matter for imports.
pub(super) fn script_blocks(source: &[u8]) -> Vec<ScriptBlock> {
    let mut blocks = Vec::new();
    let mut pos = 0;
    while pos < source.len() {
        if source[pos..].starts_with(COMMENT_OPEN) {
            pos = find(source, pos + COMMENT_OPEN.len(), COMMENT_CLOSE)
                .map_or(source.len(), |end| end + COMMENT_CLOSE.len());
            continue;
        }
        let Some(tag) = open_tag(source, pos) else {
            pos += 1;
            continue;
        };
        pos = tag.end;
        if tag.self_closing {
            continue;
        }
        let close = find_ignore_case(source, tag.end, SCRIPT_CLOSE).unwrap_or(source.len());
        blocks.push(ScriptBlock {
            kind: kind_of(&tag.attributes),
            range: tag.end..close,
        });
        pos = close;
    }
    blocks
}

struct OpenTag {
    attributes: String,
    end: usize,
    self_closing: bool,
}

fn open_tag(source: &[u8], pos: usize) -> Option<OpenTag> {
    let head = source.get(pos..pos + SCRIPT_TAG.len())?;
    if !head.eq_ignore_ascii_case(SCRIPT_TAG) {
        return None;
    }
    let after_name = pos + SCRIPT_TAG.len();
    let next = *source.get(after_name)?;
    if !(next.is_ascii_whitespace() || next == b'>' || next == b'/') {
        return None;
    }
    let close = tag_close(source, after_name)?;
    let raw = String::from_utf8_lossy(&source[after_name..close]).into_owned();
    let self_closing = raw.trim_end().ends_with('/');
    Some(OpenTag {
        attributes: raw
            .trim_end_matches(['/', ' ', '\t', '\r', '\n'])
            .to_string(),
        end: close + 1,
        self_closing,
    })
}

fn tag_close(source: &[u8], from: usize) -> Option<usize> {
    let mut quote: Option<u8> = None;
    for (offset, byte) in source.get(from..)?.iter().enumerate() {
        match (quote, *byte) {
            (Some(open), byte) if byte == open => quote = None,
            (Some(_), _) => {}
            (None, b'"' | b'\'') => quote = Some(*byte),
            (None, b'>') => return Some(from + offset),
            (None, _) => {}
        }
    }
    None
}

fn kind_of(attributes: &str) -> SourceKind {
    let language = attribute(attributes, "lang").map(|value| value.to_ascii_lowercase());
    match language.as_deref() {
        Some("ts" | "typescript") => SourceKind::TypeScript,
        Some("tsx") => SourceKind::Tsx,
        _ => SourceKind::JavaScript,
    }
}

fn attribute(attributes: &str, name: &str) -> Option<String> {
    let lowered = attributes.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lowered[from..].find(name) {
        let start = from + found;
        from = start + name.len();
        let boundary = start == 0 || lowered.as_bytes()[start - 1].is_ascii_whitespace();
        let rest = attributes[from..].trim_start();
        if !boundary || !rest.starts_with('=') {
            continue;
        }
        let value = rest[1..].trim_start();
        return Some(match value.chars().next()? {
            quote @ ('"' | '\'') => value[1..].split(quote).next()?.to_string(),
            _ => value.split_whitespace().next()?.to_string(),
        });
    }
    None
}

fn find(source: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    source
        .get(from..)?
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|offset| from + offset)
}

fn find_ignore_case(source: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    source
        .get(from..)?
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
        .map(|offset| from + offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bodies(source: &str) -> Vec<(SourceKind, &str)> {
        script_blocks(source.as_bytes())
            .into_iter()
            .map(|block| (block.kind, &source[block.range]))
            .collect()
    }

    #[test]
    fn finds_plain_and_typed_script_blocks() {
        let source = "<script>\nlet a = 1;\n</script>\n<template/>\n<script setup lang=\"ts\">\nlet b = 2;\n</script>\n";
        assert_eq!(
            bodies(source),
            vec![
                (SourceKind::JavaScript, "\nlet a = 1;\n"),
                (SourceKind::TypeScript, "\nlet b = 2;\n"),
            ]
        );
    }

    #[test]
    fn reads_the_language_from_any_quoting_style() {
        assert_eq!(
            bodies("<script lang='tsx'>x</script>")[0].0,
            SourceKind::Tsx
        );
        assert_eq!(
            bodies("<script lang=ts>x</script>")[0].0,
            SourceKind::TypeScript
        );
        assert_eq!(
            bodies("<SCRIPT LANG=\"TS\">x</SCRIPT>")[0].0,
            SourceKind::TypeScript
        );
        assert_eq!(
            bodies("<script type=\"module\">x</script>")[0].0,
            SourceKind::JavaScript
        );
    }

    #[test]
    fn quoted_angle_brackets_do_not_end_the_opening_tag() {
        let source = "<script setup lang=\"ts\" generic=\"T extends Array<string>\">body</script>";
        assert_eq!(bodies(source), vec![(SourceKind::TypeScript, "body")]);
    }

    #[test]
    fn commented_out_and_self_closing_scripts_have_no_body() {
        let source = "<!-- <script>import 'x'</script> -->\n<script src=\"./a.js\" />\n<script>real</script>\n";
        assert_eq!(bodies(source), vec![(SourceKind::JavaScript, "real")]);
    }

    #[test]
    fn similarly_named_tags_are_not_scripts() {
        assert!(bodies("<scripture>x</scripture>").is_empty());
    }

    #[test]
    fn an_unclosed_script_runs_to_the_end_of_the_file() {
        assert_eq!(
            bodies("<script>import 'a'"),
            vec![(SourceKind::JavaScript, "import 'a'")]
        );
    }

    #[test]
    fn components_without_scripts_have_no_blocks() {
        assert!(bodies("<template><p>hi</p></template>").is_empty());
        assert!(bodies("").is_empty());
    }
}
