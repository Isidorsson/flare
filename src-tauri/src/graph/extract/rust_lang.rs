use tree_sitter::Node;

use super::{node_text, walk_tree, RawImport};

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    let mut imports = Vec::new();
    walk_tree(
        root,
        inline_module_name,
        source,
        |node, inline| match node.kind() {
            "use_declaration" => {
                let Some(argument) = node.child_by_field_name("argument") else {
                    return;
                };
                for path in flatten_use_tree(argument, &[], source) {
                    imports.push(RawImport::RustUse {
                        path,
                        inline: inline.to_vec(),
                    });
                }
            }
            "mod_item" if node.child_by_field_name("body").is_none() => {
                if let Some(name) = node.child_by_field_name("name") {
                    imports.push(RawImport::RustMod {
                        name: node_text(name, source).to_string(),
                        inline: inline.to_vec(),
                    });
                }
            }
            _ => {}
        },
    );
    imports
}

fn inline_module_name(node: Node<'_>, source: &[u8]) -> Option<String> {
    if node.kind() != "mod_item" || node.child_by_field_name("body").is_none() {
        return None;
    }
    let name = node.child_by_field_name("name")?;
    Some(node_text(name, source).to_string())
}

fn segments(text: &str) -> Vec<String> {
    text.split("::")
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect()
}

fn extended(prefix: &[String], tail: Vec<String>) -> Vec<String> {
    let mut path = prefix.to_vec();
    path.extend(tail);
    if path.len() > 1 && path.last().map(String::as_str) == Some("self") {
        path.pop();
    }
    path
}

fn flatten_use_tree(node: Node<'_>, prefix: &[String], source: &[u8]) -> Vec<Vec<String>> {
    match node.kind() {
        "use_list" => flatten_children(node, prefix, source),
        "scoped_use_list" => {
            let head = node
                .child_by_field_name("path")
                .map(|path| segments(node_text(path, source)))
                .unwrap_or_default();
            let scope = extended(prefix, head);
            match node.child_by_field_name("list") {
                Some(list) => flatten_children(list, &scope, source),
                None => vec![scope],
            }
        }
        "use_as_clause" => match node.child_by_field_name("path") {
            Some(path) => flatten_use_tree(path, prefix, source),
            None => Vec::new(),
        },
        "use_wildcard" => {
            let head = node
                .named_child(0)
                .map(|path| segments(node_text(path, source)))
                .unwrap_or_default();
            vec![extended(prefix, head)]
        }
        _ => vec![extended(prefix, segments(node_text(node, source)))],
    }
}

fn flatten_children(list: Node<'_>, prefix: &[String], source: &[u8]) -> Vec<Vec<String>> {
    let mut cursor = list.walk();
    let paths = list
        .named_children(&mut cursor)
        .filter(|child| !child.is_extra())
        .flat_map(|child| flatten_use_tree(child, prefix, source))
        .collect();
    paths
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn extract_rust(source: &str) -> Vec<RawImport> {
        Extractor::new()
            .extract(SourceKind::Rust, "lib.rs", source.as_bytes())
            .unwrap()
            .imports
    }

    fn uses(source: &str) -> Vec<Vec<String>> {
        extract_rust(source)
            .into_iter()
            .filter_map(|import| match import {
                RawImport::RustUse { path, .. } => Some(path),
                _ => None,
            })
            .collect()
    }

    fn path(text: &str) -> Vec<String> {
        text.split("::").map(str::to_string).collect()
    }

    #[test]
    fn finds_external_module_declarations_only() {
        let imports = extract_rust("mod a;\npub mod b;\nmod inline { fn f() {} }\n");
        assert_eq!(
            imports,
            vec![
                RawImport::RustMod {
                    name: "a".into(),
                    inline: vec![]
                },
                RawImport::RustMod {
                    name: "b".into(),
                    inline: vec![]
                },
            ]
        );
    }

    #[test]
    fn tracks_inline_module_nesting_for_use_and_mod() {
        let source = "mod outer { use super::x; mod deep { use super::super::y; mod file; } }\nuse crate::z;";
        let imports = extract_rust(source);
        assert_eq!(
            imports,
            vec![
                RawImport::RustUse {
                    path: path("super::x"),
                    inline: vec!["outer".into()]
                },
                RawImport::RustUse {
                    path: path("super::super::y"),
                    inline: vec!["outer".into(), "deep".into()]
                },
                RawImport::RustMod {
                    name: "file".into(),
                    inline: vec!["outer".into(), "deep".into()]
                },
                RawImport::RustUse {
                    path: path("crate::z"),
                    inline: vec![]
                },
            ]
        );
    }

    #[test]
    fn flattens_simple_scoped_aliased_and_wildcard_uses() {
        let source = "use crate::a::B;\nuse self::c as d;\nuse super::e::*;\nuse std::collections::HashMap;\nuse f;";
        assert_eq!(
            uses(source),
            vec![
                path("crate::a::B"),
                path("self::c"),
                path("super::e"),
                path("std::collections::HashMap"),
                path("f"),
            ]
        );
    }

    #[test]
    fn expands_nested_use_lists() {
        let source = "use crate::{a, b::{c, d as e, f::*}, self};\nuse x::y::{self, z};";
        assert_eq!(
            uses(source),
            vec![
                path("crate::a"),
                path("crate::b::c"),
                path("crate::b::d"),
                path("crate::b::f"),
                path("crate"),
                path("x::y"),
                path("x::y::z"),
            ]
        );
    }

    #[test]
    fn handles_visibility_modifiers_and_nested_function_uses() {
        let source =
            "pub use crate::a::A;\npub(crate) use crate::b::B;\nfn f() { use crate::c::C; }";
        assert_eq!(
            uses(source),
            vec![
                path("crate::a::A"),
                path("crate::b::B"),
                path("crate::c::C")
            ]
        );
    }
}
