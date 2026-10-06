use tree_sitter::Node;

use super::{child_of_kind, compact_name, node_text, walk_tree, RawImport};

const INCLUDE_KINDS: [&str; 4] = [
    "require_expression",
    "require_once_expression",
    "include_expression",
    "include_once_expression",
];
const CURRENT_FILE: &str = "__FILE__";
const CURRENT_DIR: &str = "__DIR__";
const PARENT_SEGMENT: &str = "/..";

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    let mut imports = Vec::new();
    walk_tree(
        root,
        |_, _| None,
        source,
        |node, _| {
            if INCLUDE_KINDS.contains(&node.kind()) {
                imports.extend(include_of(node, source));
            } else if node.kind() == "namespace_use_declaration" {
                imports.extend(uses_of(node, source));
            }
        },
    );
    imports
}

struct PathValue {
    anchored: bool,
    text: String,
}

fn include_of(node: Node<'_>, source: &[u8]) -> Option<RawImport> {
    let value = path_value(node.named_child(0)?, source)?;
    let path = if value.anchored {
        value.text.trim_start_matches('/').to_string()
    } else {
        value.text
    };
    (!path.is_empty()).then_some(RawImport::PhpInclude { path })
}

fn path_value(node: Node<'_>, source: &[u8]) -> Option<PathValue> {
    match node.kind() {
        "string" | "encapsed_string" => Some(PathValue {
            anchored: false,
            text: plain_string(node, source)?,
        }),
        "parenthesized_expression" => path_value(node.named_child(0)?, source),
        "name" if node_text(node, source) == CURRENT_DIR => Some(anchored(String::new())),
        "function_call_expression" => dirname_value(node, source),
        "binary_expression" => concatenation(node, source),
        _ => None,
    }
}

fn anchored(text: String) -> PathValue {
    PathValue {
        anchored: true,
        text,
    }
}

fn concatenation(node: Node<'_>, source: &[u8]) -> Option<PathValue> {
    if node_text(node.child_by_field_name("operator")?, source) != "." {
        return None;
    }
    let left = path_value(node.child_by_field_name("left")?, source)?;
    let right = path_value(node.child_by_field_name("right")?, source)?;
    if right.anchored {
        return None;
    }
    Some(PathValue {
        anchored: left.anchored,
        text: left.text + &right.text,
    })
}

fn dirname_value(call: Node<'_>, source: &[u8]) -> Option<PathValue> {
    if node_text(call.child_by_field_name("function")?, source) != "dirname" {
        return None;
    }
    let argument = child_of_kind(call.child_by_field_name("arguments")?, "argument")?;
    match node_text(argument.named_child(0)?, source) {
        CURRENT_FILE => Some(anchored(String::new())),
        CURRENT_DIR => Some(anchored(PARENT_SEGMENT.to_string())),
        _ => None,
    }
}

fn plain_string(node: Node<'_>, source: &[u8]) -> Option<String> {
    let mut cursor = node.walk();
    let mut parts = node.named_children(&mut cursor);
    let content = parts.next()?;
    let is_plain = content.kind() == "string_content" && parts.next().is_none();
    is_plain.then(|| node_text(content, source).to_string())
}

fn uses_of(node: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    if imports_functions_or_constants(node) {
        return Vec::new();
    }
    let prefix = child_of_kind(node, "namespace_name").map(|name| compact_name(name, source));
    let clauses = match node.child_by_field_name("body") {
        Some(group) => clauses_of(group),
        None => clauses_of(node),
    };
    clauses
        .into_iter()
        .filter(|clause| !imports_functions_or_constants(*clause))
        .filter_map(|clause| clause_name(clause, source))
        .map(|name| RawImport::PhpUse {
            name: match &prefix {
                Some(prefix) => format!("{}\\{name}", prefix.trim_start_matches('\\')),
                None => name,
            },
        })
        .collect()
}

fn imports_functions_or_constants(node: Node<'_>) -> bool {
    let mut cursor = node.walk();
    let found = node
        .children(&mut cursor)
        .any(|child| matches!(child.kind(), "function" | "const"));
    found
}

fn clauses_of(parent: Node<'_>) -> Vec<Node<'_>> {
    let mut cursor = parent.walk();
    let clauses = parent
        .named_children(&mut cursor)
        .filter(|child| child.kind() == "namespace_use_clause")
        .collect();
    clauses
}

fn clause_name(clause: Node<'_>, source: &[u8]) -> Option<String> {
    let mut cursor = clause.walk();
    let name = clause
        .named_children(&mut cursor)
        .find(|child| matches!(child.kind(), "qualified_name" | "name"))?;
    Some(
        compact_name(name, source)
            .trim_start_matches('\\')
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn php(source: &str) -> Vec<RawImport> {
        Extractor::new()
            .extract(SourceKind::Php, "a.php", source.as_bytes())
            .unwrap()
            .imports
    }

    fn include(path: &str) -> RawImport {
        RawImport::PhpInclude { path: path.into() }
    }

    fn used(name: &str) -> RawImport {
        RawImport::PhpUse { name: name.into() }
    }

    #[test]
    fn finds_literal_and_directory_anchored_includes() {
        let source = "<?php\nrequire 'a.php';\nrequire_once __DIR__ . '/b.php';\ninclude(dirname(__FILE__) . \"/c.php\");\ninclude_once dirname(__DIR__) . '/d.php';\nrequire __DIR__ . '/../e.php';\n";
        assert_eq!(
            php(source),
            vec![
                include("a.php"),
                include("b.php"),
                include("c.php"),
                include("../d.php"),
                include("../e.php"),
            ]
        );
    }

    #[test]
    fn computed_include_paths_are_skipped() {
        let source = "<?php\nrequire $path;\nrequire __DIR__ . $name;\ninclude \"x/$y.php\";\n";
        assert!(php(source).is_empty());
    }

    #[test]
    fn finds_plain_aliased_grouped_and_rooted_uses() {
        let source = "<?php\nuse App\\Models\\User;\nuse \\App\\Foo;\nuse App\\Svc\\{A, B as C, Deep\\D};\nuse App\\E as F;\n";
        assert_eq!(
            php(source),
            vec![
                used("App\\Models\\User"),
                used("App\\Foo"),
                used("App\\Svc\\A"),
                used("App\\Svc\\B"),
                used("App\\Svc\\Deep\\D"),
                used("App\\E"),
            ]
        );
    }

    #[test]
    fn function_and_constant_imports_are_not_class_files() {
        let source = "<?php\nuse function App\\f;\nuse const App\\C;\nclass X { use T; }\n";
        assert!(php(source).is_empty());
    }
}
