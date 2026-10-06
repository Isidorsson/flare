use tree_sitter::Node;

use super::{node_text, strip_quotes, walk_tree, RawImport};

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    let mut imports = Vec::new();
    walk_tree(
        root,
        |_, _| None,
        source,
        |node, _| imports.extend(quoted_include(node, source)),
    );
    imports
}

fn quoted_include(node: Node<'_>, source: &[u8]) -> Option<RawImport> {
    if node.kind() != "preproc_include" {
        return None;
    }
    let path = node.child_by_field_name("path")?;
    if path.kind() != "string_literal" {
        return None;
    }
    Some(RawImport::Include {
        path: strip_quotes(node_text(path, source)).to_string(),
    })
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn includes(kind: SourceKind, source: &str) -> Vec<String> {
        Extractor::new()
            .extract(kind, "test", source.as_bytes())
            .unwrap()
            .imports
            .into_iter()
            .map(|import| match import {
                RawImport::Include { path } => path,
                other => panic!("unexpected import {other:?}"),
            })
            .collect()
    }

    #[test]
    fn keeps_quoted_includes_and_drops_system_and_macro_ones() {
        let source = "#include \"a.h\"\n#include <stdio.h>\n#include MACRO\n#include \"sub/b.h\"\n";
        assert_eq!(includes(SourceKind::C, source), ["a.h", "sub/b.h"]);
    }

    #[test]
    fn finds_includes_inside_conditional_blocks_and_after_code() {
        let source = "#if defined(X)\n#  include \"a.h\"\n#else\n#include \"b.h\"\n#endif\nint main() { return 0; }\n#include \"tail.h\"\n";
        assert_eq!(includes(SourceKind::Cpp, source), ["a.h", "b.h", "tail.h"]);
    }

    #[test]
    fn cpp_constructs_in_a_dot_h_header_do_not_hide_includes() {
        let source = "#pragma once\n#include \"a.h\"\nnamespace foo { class A { public: template<typename T> void f(); }; }\n#include \"b.h\"\n";
        assert_eq!(includes(SourceKind::C, source), ["a.h", "b.h"]);
        assert_eq!(includes(SourceKind::Cpp, source), ["a.h", "b.h"]);
    }
}
