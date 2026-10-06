use tree_sitter::Node;

use super::{child_of_kind, node_text, walk_tree, RawImport};

const IMPORT_BUILTIN: &str = "@import";

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    let mut imports = Vec::new();
    walk_tree(
        root,
        |_, _| None,
        source,
        |node, _| imports.extend(import_of(node, source)),
    );
    imports
}

fn import_of(node: Node<'_>, source: &[u8]) -> Option<RawImport> {
    if node.kind() != "builtin_function" {
        return None;
    }
    let builtin = child_of_kind(node, "builtin_identifier")?;
    if node_text(builtin, source) != IMPORT_BUILTIN {
        return None;
    }
    let argument = child_of_kind(node, "arguments")?.named_child(0)?;
    if argument.kind() != "string" {
        return None;
    }
    let content = child_of_kind(argument, "string_content")?;
    Some(RawImport::ZigImport {
        path: node_text(content, source).to_string(),
    })
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn paths(source: &str) -> Vec<String> {
        Extractor::new()
            .extract(SourceKind::Zig, "a.zig", source.as_bytes())
            .unwrap()
            .imports
            .into_iter()
            .map(|import| match import {
                RawImport::ZigImport { path } => path,
                other => panic!("unexpected import {other:?}"),
            })
            .collect()
    }

    #[test]
    fn finds_import_builtins_including_chained_member_access() {
        let source = "const std = @import(\"std\");\nconst a = @import(\"a.zig\");\nconst b = @import(\"sub/b.zig\").thing;\n";
        assert_eq!(paths(source), ["std", "a.zig", "sub/b.zig"]);
    }

    #[test]
    fn other_builtins_and_comptime_paths_are_ignored() {
        let source = "const x = @as(u8, 1);\nconst y = @cImport(@cInclude(\"x.h\"));\nconst z = @import(name);\n";
        assert!(paths(source).is_empty());
    }
}
