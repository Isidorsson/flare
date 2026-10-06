use tree_sitter::Node;

use super::{child_of_kind, compact_name, node_text, Declared, Extraction, RawImport};

const JAVA_TYPE_DECLARATIONS: [&str; 5] = [
    "class_declaration",
    "interface_declaration",
    "enum_declaration",
    "record_declaration",
    "annotation_type_declaration",
];
const KOTLIN_NAMED_DECLARATIONS: [&str; 3] = [
    "class_declaration",
    "object_declaration",
    "function_declaration",
];

pub(super) fn extract_java(root: Node<'_>, source: &[u8]) -> Extraction {
    let mut collector = Collector::default();
    let mut cursor = root.walk();
    for node in root.children(&mut cursor) {
        match node.kind() {
            "package_declaration" => collector.package(qualified_child(node), source),
            "import_declaration" => collector.java_import(node, source),
            kind if JAVA_TYPE_DECLARATIONS.contains(&kind) => {
                collector.symbol(node.child_by_field_name("name"), source);
            }
            _ => {}
        }
    }
    collector.finish()
}

pub(super) fn extract_kotlin(root: Node<'_>, source: &[u8]) -> Extraction {
    let mut collector = Collector::default();
    let mut cursor = root.walk();
    for node in root.children(&mut cursor) {
        match node.kind() {
            "package_header" => collector.package(qualified_child(node), source),
            "import" => collector.kotlin_import(node, source),
            "property_declaration" => {
                let variable = child_of_kind(node, "variable_declaration");
                collector.symbol(variable.and_then(first_named), source);
            }
            "type_alias" => collector.symbol(node.child_by_field_name("type"), source),
            kind if KOTLIN_NAMED_DECLARATIONS.contains(&kind) => {
                collector.symbol(node.child_by_field_name("name"), source);
            }
            _ => {}
        }
    }
    collector.finish()
}

#[derive(Default)]
struct Collector {
    package: String,
    extraction: Extraction,
}

impl Collector {
    fn package(&mut self, name: Option<Node<'_>>, source: &[u8]) {
        let Some(name) = name else { return };
        self.package = compact_name(name, source);
        self.extraction
            .declared
            .push(Declared::Namespace(self.package.clone()));
    }

    fn symbol(&mut self, name: Option<Node<'_>>, source: &[u8]) {
        let Some(name) = name else { return };
        let simple = node_text(name, source);
        let qualified = if self.package.is_empty() {
            simple.to_string()
        } else {
            format!("{}.{simple}", self.package)
        };
        self.extraction.declared.push(Declared::Symbol(qualified));
    }

    fn java_import(&mut self, node: Node<'_>, source: &[u8]) {
        let wildcard = child_of_kind(node, "asterisk").is_some();
        self.import(node, wildcard, source);
    }

    fn kotlin_import(&mut self, node: Node<'_>, source: &[u8]) {
        let text = node_text(node, source);
        let wildcard = text.trim_end_matches(';').trim_end().ends_with('*');
        self.import(node, wildcard, source);
    }

    fn import(&mut self, node: Node<'_>, wildcard: bool, source: &[u8]) {
        if let Some(name) = qualified_child(node) {
            self.extraction.imports.push(RawImport::JvmImport {
                name: compact_name(name, source),
                wildcard,
            });
        }
    }

    fn finish(mut self) -> Extraction {
        self.extraction.declared.sort();
        self.extraction.declared.dedup();
        self.extraction
    }
}

fn first_named(node: Node<'_>) -> Option<Node<'_>> {
    node.named_child(0)
}

fn qualified_child(node: Node<'_>) -> Option<Node<'_>> {
    let mut cursor = node.walk();
    let found = node.named_children(&mut cursor).find(|child| {
        matches!(
            child.kind(),
            "scoped_identifier" | "qualified_identifier" | "identifier"
        )
    });
    found
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn extract(kind: SourceKind, source: &str) -> Extraction {
        Extractor::new()
            .extract(kind, "test", source.as_bytes())
            .unwrap()
    }

    fn import(name: &str, wildcard: bool) -> RawImport {
        RawImport::JvmImport {
            name: name.into(),
            wildcard,
        }
    }

    fn namespace(name: &str) -> Declared {
        Declared::Namespace(name.into())
    }

    fn symbol(name: &str) -> Declared {
        Declared::Symbol(name.into())
    }

    #[test]
    fn java_imports_cover_plain_static_and_wildcard_forms() {
        let source =
            "package a.b;\nimport a.b.C;\nimport static a.b.D.m;\nimport a.e.*;\nclass X {}\n";
        assert_eq!(
            extract(SourceKind::Java, source).imports,
            vec![
                import("a.b.C", false),
                import("a.b.D.m", false),
                import("a.e", true)
            ]
        );
    }

    #[test]
    fn java_declares_its_package_and_top_level_types() {
        let source = "package a;\npublic class A {}\ninterface I {}\nenum E { X }\nrecord R(int x) {}\n@interface Ann {}\n";
        assert_eq!(
            extract(SourceKind::Java, source).declared,
            vec![
                namespace("a"),
                symbol("a.A"),
                symbol("a.Ann"),
                symbol("a.E"),
                symbol("a.I"),
                symbol("a.R"),
            ]
        );
    }

    #[test]
    fn java_files_without_a_package_declare_bare_symbols() {
        let extraction = extract(SourceKind::Java, "class Main {}\n");
        assert_eq!(extraction.declared, vec![symbol("Main")]);
    }

    #[test]
    fn kotlin_imports_cover_plain_alias_and_wildcard_forms() {
        let source = "package a.b\nimport a.b.C\nimport a.e.*\nimport a.f.G as H\nclass X\n";
        assert_eq!(
            extract(SourceKind::Kotlin, source).imports,
            vec![
                import("a.b.C", false),
                import("a.e", true),
                import("a.f.G", false)
            ]
        );
    }

    #[test]
    fn kotlin_declares_every_kind_of_top_level_symbol() {
        let source = "package a.b\nclass A\ninterface I\nobject O\nfun f() {}\nval v = 1\ntypealias T = Int\nenum class E { X }\nfun Int.ext() {}\n";
        assert_eq!(
            extract(SourceKind::Kotlin, source).declared,
            vec![
                namespace("a.b"),
                symbol("a.b.A"),
                symbol("a.b.E"),
                symbol("a.b.I"),
                symbol("a.b.O"),
                symbol("a.b.T"),
                symbol("a.b.ext"),
                symbol("a.b.f"),
                symbol("a.b.v"),
            ]
        );
    }

    #[test]
    fn nested_declarations_are_not_top_level_symbols() {
        let source =
            "package p\n\nclass Outer {\n    class Inner {\n        fun m() {}\n    }\n}\n";
        assert_eq!(
            extract(SourceKind::Kotlin, source).declared,
            vec![namespace("p"), symbol("p.Outer")]
        );
    }
}
