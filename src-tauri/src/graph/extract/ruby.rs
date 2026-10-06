use tree_sitter::Node;

use super::{node_text, walk_tree, RawImport};

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    let mut imports = Vec::new();
    walk_tree(
        root,
        |_, _| None,
        source,
        |node, _| imports.extend(load_of(node, source)),
    );
    imports
}

fn load_of(call: Node<'_>, source: &[u8]) -> Option<RawImport> {
    if call.kind() != "call" || call.child_by_field_name("receiver").is_some() {
        return None;
    }
    let method = node_text(call.child_by_field_name("method")?, source);
    let arguments = call.child_by_field_name("arguments")?;
    let (index, relative) = match method {
        "require" => (0, false),
        "require_relative" => (0, true),
        "autoload" => (1, false),
        _ => return None,
    };
    let path = literal(arguments.named_child(index)?, source)?;
    Some(RawImport::RubyRequire { path, relative })
}

fn literal(node: Node<'_>, source: &[u8]) -> Option<String> {
    if node.kind() != "string" {
        return None;
    }
    let mut cursor = node.walk();
    let mut parts = node.named_children(&mut cursor);
    let content = parts.next()?;
    let is_plain = content.kind() == "string_content" && parts.next().is_none();
    is_plain.then(|| node_text(content, source).to_string())
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn requires(source: &str) -> Vec<(String, bool)> {
        Extractor::new()
            .extract(SourceKind::Ruby, "a.rb", source.as_bytes())
            .unwrap()
            .imports
            .into_iter()
            .map(|import| match import {
                RawImport::RubyRequire { path, relative } => (path, relative),
                other => panic!("unexpected import {other:?}"),
            })
            .collect()
    }

    fn entry(path: &str, relative: bool) -> (String, bool) {
        (path.to_string(), relative)
    }

    #[test]
    fn finds_require_and_require_relative_with_either_call_style() {
        let source =
            "require 'a/b'\nrequire_relative \"c\"\nrequire_relative('d')\nputs require('e')\n";
        assert_eq!(
            requires(source),
            vec![
                entry("a/b", false),
                entry("c", true),
                entry("d", true),
                entry("e", false)
            ]
        );
    }

    #[test]
    fn autoload_registers_its_second_argument() {
        assert_eq!(
            requires("autoload :Widget, 'gem/widget'\n"),
            vec![entry("gem/widget", false)]
        );
    }

    #[test]
    fn computed_and_receiver_calls_are_not_literal_requires() {
        let source = "require \"x#{y}\"\nrequire File.join(__dir__, 'e')\nKernel.require 'k'\nrequire name\nother('f')\n";
        assert!(requires(source).is_empty());
    }
}
