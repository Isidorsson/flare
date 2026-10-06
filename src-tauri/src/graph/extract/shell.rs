use tree_sitter::Node;

use super::{node_text, strip_quotes, walk_tree, RawImport};

const SOURCE_COMMANDS: [&str; 2] = ["source", "."];

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    let mut imports = Vec::new();
    walk_tree(
        root,
        |_, _| None,
        source,
        |node, _| imports.extend(source_of(node, source)),
    );
    imports
}

fn source_of(command: Node<'_>, source: &[u8]) -> Option<RawImport> {
    if command.kind() != "command" {
        return None;
    }
    let name = node_text(command.child_by_field_name("name")?, source);
    if !SOURCE_COMMANDS.contains(&name) {
        return None;
    }
    let path = literal(command.child_by_field_name("argument")?, source)?;
    Some(RawImport::ShellSource { path })
}

fn literal(argument: Node<'_>, source: &[u8]) -> Option<String> {
    let text = node_text(argument, source);
    match argument.kind() {
        "word" => Some(text.to_string()),
        "raw_string" => Some(strip_quotes(text).to_string()),
        "string" if is_plain_string(argument) => Some(strip_quotes(text).to_string()),
        _ => None,
    }
}

fn is_plain_string(string: Node<'_>) -> bool {
    let mut cursor = string.walk();
    let plain = string
        .named_children(&mut cursor)
        .all(|part| part.kind() == "string_content");
    plain
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn sourced(text: &str) -> Vec<String> {
        Extractor::new()
            .extract(SourceKind::Shell, "run.sh", text.as_bytes())
            .unwrap()
            .imports
            .into_iter()
            .map(|import| match import {
                RawImport::ShellSource { path } => path,
                other => panic!("unexpected import {other:?}"),
            })
            .collect()
    }

    #[test]
    fn finds_source_and_dot_with_every_quoting_style() {
        let text = "source ./a.sh\n. \"b.sh\"\nsource 'c.sh' arg\nif true; then . ./d.sh; fi\n";
        assert_eq!(sourced(text), ["./a.sh", "b.sh", "c.sh", "./d.sh"]);
    }

    #[test]
    fn variable_paths_are_not_literal() {
        let text = "source $DIR/e.sh\nsource \"$DIR/f.sh\"\nsource \"$(dirname \"$0\")/g.sh\"\n";
        assert!(sourced(text).is_empty());
    }

    #[test]
    fn other_commands_are_ignored() {
        assert!(sourced("echo source ./a.sh\ncat ./b.sh\n").is_empty());
    }
}
