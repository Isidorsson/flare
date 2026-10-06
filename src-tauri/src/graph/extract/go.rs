use tree_sitter::Node;

use super::{node_text, walk_tree, RawImport};

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    let mut imports = Vec::new();
    walk_tree(
        root,
        |_, _| None,
        source,
        |node, _| {
            if node.kind() != "import_spec" {
                return;
            }
            if let Some(path) = node.child_by_field_name("path") {
                let literal = node_text(path, source).trim_matches(['"', '`']);
                imports.push(RawImport::GoImport {
                    path: literal.to_string(),
                });
            }
        },
    );
    imports
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn paths(source: &str) -> Vec<String> {
        Extractor::new()
            .extract(SourceKind::Go, "main.go", source.as_bytes())
            .unwrap()
            .imports
            .into_iter()
            .map(|import| match import {
                RawImport::GoImport { path } => path,
                other => panic!("unexpected import {other:?}"),
            })
            .collect()
    }

    #[test]
    fn finds_single_grouped_aliased_and_raw_imports() {
        let source = "package main\nimport \"fmt\"\nimport (\n  a \"x/y\"\n  _ \"z/w\"\n  . \"d\"\n  `raw/path`\n)\n";
        assert_eq!(paths(source), ["fmt", "x/y", "z/w", "d", "raw/path"]);
    }

    #[test]
    fn cgo_pseudo_imports_are_kept_for_the_resolver_to_reject() {
        assert_eq!(paths("package main\nimport \"C\"\n"), ["C"]);
    }

    #[test]
    fn import_like_text_in_comments_and_strings_is_ignored() {
        let source = "package main\n// import \"commented\"\nvar s = \"import \\\"str\\\"\"\n";
        assert!(paths(source).is_empty());
    }
}
