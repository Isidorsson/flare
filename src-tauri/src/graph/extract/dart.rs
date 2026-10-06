use tree_sitter::Node;

use super::{node_text, walk_tree, RawImport};

const DIRECTIVES: [&str; 3] = ["import_specification", "library_export", "part_directive"];

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    let mut imports = Vec::new();
    walk_tree(
        root,
        |_, _| None,
        source,
        |node, _| {
            if DIRECTIVES.contains(&node.kind()) {
                collect_uris(node, source, &mut imports);
            }
        },
    );
    imports
}

fn collect_uris(node: Node<'_>, source: &[u8], imports: &mut Vec<RawImport>) {
    if node.kind() == "uri" {
        if let Some(uri) = dart_string(node_text(node, source)) {
            imports.push(RawImport::DartImport { uri });
        }
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_uris(child, source, imports);
    }
}

fn dart_string(literal: &str) -> Option<String> {
    let body = literal.trim_start_matches(['r', 'R']);
    let delimiter = ["'''", "\"\"\"", "'", "\""]
        .into_iter()
        .find(|quote| body.starts_with(quote))?;
    let inner = body
        .strip_prefix(delimiter)?
        .strip_suffix(delimiter)?
        .to_string();
    Some(inner)
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn uris(source: &str) -> Vec<String> {
        Extractor::new()
            .extract(SourceKind::Dart, "a.dart", source.as_bytes())
            .unwrap()
            .imports
            .into_iter()
            .map(|import| match import {
                RawImport::DartImport { uri } => uri,
                other => panic!("unexpected import {other:?}"),
            })
            .collect()
    }

    #[test]
    fn finds_imports_exports_and_parts() {
        let source = "library x;\nimport 'package:a/b.dart';\nimport \"c.dart\" as c;\nimport 'dart:io';\nexport 'd.dart';\npart 'e.g.dart';\n";
        assert_eq!(
            uris(source),
            [
                "package:a/b.dart",
                "c.dart",
                "dart:io",
                "d.dart",
                "e.g.dart"
            ]
        );
    }

    #[test]
    fn conditional_imports_yield_every_alternative() {
        let source = "export 'src/stub.dart' if (dart.library.html) 'src/web.dart';\nimport 'a.dart' if (dart.library.io == 'true') 'b.dart';\n";
        assert_eq!(
            uris(source),
            ["src/stub.dart", "src/web.dart", "a.dart", "b.dart"]
        );
    }

    #[test]
    fn part_of_directives_are_not_dependencies() {
        assert!(uris("part of 'lib.dart';\n").is_empty());
    }

    #[test]
    fn raw_and_triple_quoted_uris_are_unwrapped() {
        let source = "import r'raw.dart';\nimport '''triple.dart''';\n";
        assert_eq!(uris(source), ["raw.dart", "triple.dart"]);
    }
}
