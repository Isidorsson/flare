use tree_sitter::Node;

use super::{node_text, walk_tree, RawImport};

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    let mut imports = Vec::new();
    walk_tree(
        root,
        |_, _| None,
        source,
        |node, _| match node.kind() {
            "import_statement" => {
                for name in imported_names(node, source) {
                    imports.push(RawImport::Python {
                        level: 0,
                        module: dotted(&name),
                        names: Vec::new(),
                    });
                }
            }
            "import_from_statement" => {
                if let Some(import) = from_import(node, source) {
                    imports.push(import);
                }
            }
            _ => {}
        },
    );
    imports
}

fn from_import(node: Node<'_>, source: &[u8]) -> Option<RawImport> {
    let module_node = node.child_by_field_name("module_name")?;
    let text = node_text(module_node, source);
    let level = text.chars().take_while(|ch| *ch == '.').count();
    Some(RawImport::Python {
        level,
        module: dotted(&text[level..]),
        names: imported_names(node, source)
            .iter()
            .map(|name| name.trim().to_string())
            .collect(),
    })
}

fn imported_names(node: Node<'_>, source: &[u8]) -> Vec<String> {
    let mut cursor = node.walk();
    let names = node
        .children_by_field_name("name", &mut cursor)
        .filter_map(|child| match child.kind() {
            "aliased_import" => child.child_by_field_name("name"),
            "dotted_name" => Some(child),
            _ => None,
        })
        .map(|child| node_text(child, source).to_string())
        .collect();
    names
}

fn dotted(text: &str) -> Vec<String> {
    text.split('.')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn python(source: &str) -> Vec<RawImport> {
        Extractor::new()
            .extract(SourceKind::Python, "m.py", source.as_bytes())
            .unwrap()
    }

    fn import(level: usize, module: &[&str], names: &[&str]) -> RawImport {
        RawImport::Python {
            level,
            module: module.iter().map(ToString::to_string).collect(),
            names: names.iter().map(ToString::to_string).collect(),
        }
    }

    #[test]
    fn finds_plain_and_aliased_imports() {
        let imports = python("import os\nimport a.b.c\nimport x as y, z.w as v\n");
        assert_eq!(
            imports,
            vec![
                import(0, &["os"], &[]),
                import(0, &["a", "b", "c"], &[]),
                import(0, &["x"], &[]),
                import(0, &["z", "w"], &[]),
            ]
        );
    }

    #[test]
    fn finds_from_imports_with_names_and_aliases() {
        let imports = python("from pkg.mod import a, b as c\nfrom pkg import (d,\n    e)\n");
        assert_eq!(
            imports,
            vec![
                import(0, &["pkg", "mod"], &["a", "b"]),
                import(0, &["pkg"], &["d", "e"]),
            ]
        );
    }

    #[test]
    fn counts_relative_import_levels() {
        let imports = python("from . import sibling\nfrom .child import x\nfrom ..up.deep import y\nfrom ... import z\n");
        assert_eq!(
            imports,
            vec![
                import(1, &[], &["sibling"]),
                import(1, &["child"], &["x"]),
                import(2, &["up", "deep"], &["y"]),
                import(3, &[], &["z"]),
            ]
        );
    }

    #[test]
    fn wildcard_imports_have_no_names_and_nested_imports_are_found() {
        let imports =
            python("from pkg import *\n\ndef f():\n    import lazy\n    from .x import y\n");
        assert_eq!(
            imports,
            vec![
                import(0, &["pkg"], &[]),
                import(0, &["lazy"], &[]),
                import(1, &["x"], &["y"]),
            ]
        );
    }
}
