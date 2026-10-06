use tree_sitter::Node;

use super::{compact_name, walk_tree, Declared, Extraction, RawImport};

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Extraction {
    let mut extraction = Extraction::default();
    walk_tree(
        root,
        block_namespace,
        source,
        |node, enclosing| match node.kind() {
            "using_directive" => extraction.imports.extend(using_of(node, source)),
            "namespace_declaration" | "file_scoped_namespace_declaration" => {
                if let Some(name) = namespace_name(node, source) {
                    extraction
                        .declared
                        .push(Declared::Namespace(qualify(enclosing, &name)));
                }
            }
            _ => {}
        },
    );
    extraction.declared.sort();
    extraction.declared.dedup();
    extraction
}

fn block_namespace(node: Node<'_>, source: &[u8]) -> Option<String> {
    if node.kind() != "namespace_declaration" {
        return None;
    }
    namespace_name(node, source)
}

fn namespace_name(node: Node<'_>, source: &[u8]) -> Option<String> {
    Some(compact_name(node.child_by_field_name("name")?, source))
}

fn qualify(enclosing: &[String], name: &str) -> String {
    if enclosing.is_empty() {
        name.to_string()
    } else {
        format!("{}.{name}", enclosing.join("."))
    }
}

fn using_of(node: Node<'_>, source: &[u8]) -> Option<RawImport> {
    let alias = node.child_by_field_name("name");
    let mut cursor = node.walk();
    let is_static = node
        .children(&mut cursor)
        .any(|child| child.kind() == "static");
    let mut cursor = node.walk();
    let target = node.named_children(&mut cursor).find(|child| {
        Some(child.id()) != alias.map(|alias| alias.id())
            && matches!(child.kind(), "identifier" | "qualified_name")
    })?;
    Some(RawImport::CSharpUsing {
        namespace: compact_name(target, source),
        may_be_type: is_static || alias.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn extract_cs(source: &str) -> Extraction {
        Extractor::new()
            .extract(SourceKind::CSharp, "A.cs", source.as_bytes())
            .unwrap()
    }

    fn using(namespace: &str, may_be_type: bool) -> RawImport {
        RawImport::CSharpUsing {
            namespace: namespace.into(),
            may_be_type,
        }
    }

    fn namespace(name: &str) -> Declared {
        Declared::Namespace(name.into())
    }

    #[test]
    fn finds_plain_static_alias_and_global_usings() {
        let source =
            "using System;\nusing A.B;\nusing static A.C.D;\nusing X = A.E;\nglobal using F.G;\n";
        assert_eq!(
            extract_cs(source).imports,
            vec![
                using("System", false),
                using("A.B", false),
                using("A.C.D", true),
                using("A.E", true),
                using("F.G", false),
            ]
        );
    }

    #[test]
    fn declares_file_scoped_namespaces() {
        let extraction = extract_cs("using A;\nnamespace Foo.Bar;\nclass C {}\n");
        assert_eq!(extraction.declared, vec![namespace("Foo.Bar")]);
    }

    #[test]
    fn declares_block_namespaces_with_their_nesting() {
        let source =
            "namespace Foo { namespace Inner { class A {} } }\nnamespace Foo.Bar { class B {} }\n";
        assert_eq!(
            extract_cs(source).declared,
            vec![
                namespace("Foo"),
                namespace("Foo.Bar"),
                namespace("Foo.Inner")
            ]
        );
    }

    #[test]
    fn usings_inside_a_namespace_block_are_imports_too() {
        let extraction = extract_cs("namespace A { using B.C; }\n");
        assert_eq!(extraction.imports, vec![using("B.C", false)]);
    }

    #[test]
    fn files_without_a_namespace_declare_nothing() {
        assert!(extract_cs("class Program { static void Main() {} }\n")
            .declared
            .is_empty());
    }
}
