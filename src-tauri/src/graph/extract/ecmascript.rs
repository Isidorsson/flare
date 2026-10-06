use tree_sitter::Node;

use super::{node_text, walk_tree, RawImport};

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    let mut imports = Vec::new();
    walk_tree(
        root,
        |_, _| None,
        source,
        |node, _| {
            if let Some(specifier) = specifier_of(node, source) {
                imports.push(RawImport::Module { specifier });
            }
        },
    );
    imports
}

fn specifier_of(node: Node<'_>, source: &[u8]) -> Option<String> {
    match node.kind() {
        "import_statement" | "export_statement" | "import_require_clause" => {
            let literal = node.child_by_field_name("source")?;
            string_value(literal, source)
        }
        "call_expression" => call_specifier(node, source),
        _ => None,
    }
}

fn call_specifier(call: Node<'_>, source: &[u8]) -> Option<String> {
    let callee = call.child_by_field_name("function")?;
    let is_loader = callee.kind() == "import"
        || (callee.kind() == "identifier" && node_text(callee, source) == "require");
    if !is_loader {
        return None;
    }
    let arguments = call.child_by_field_name("arguments")?;
    let first = arguments.named_child(0)?;
    string_value(first, source)
}

fn string_value(node: Node<'_>, source: &[u8]) -> Option<String> {
    match node.kind() {
        "string" => unquote(node_text(node, source)),
        "template_string" if !has_substitution(node) => unquote(node_text(node, source)),
        _ => None,
    }
}

fn has_substitution(template: Node<'_>) -> bool {
    let mut cursor = template.walk();
    let found = template
        .named_children(&mut cursor)
        .any(|child| child.kind() == "template_substitution");
    found
}

fn unquote(text: &str) -> Option<String> {
    let inner = text.get(1..text.len().checked_sub(1)?)?;
    Some(inner.to_string())
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn specifiers(kind: SourceKind, source: &str) -> Vec<String> {
        Extractor::new()
            .extract(kind, "test", source.as_bytes())
            .unwrap()
            .imports
            .into_iter()
            .map(|import| match import {
                RawImport::Module { specifier } => specifier,
                other => panic!("unexpected import {other:?}"),
            })
            .collect()
    }

    #[test]
    fn finds_static_imports_in_every_form() {
        let source = r#"
import a from "./a";
import { b } from './b';
import * as c from "../c";
import "./side-effect";
import type { T } from "./types";
import d, { e } from "pkg";
"#;
        assert_eq!(
            specifiers(SourceKind::TypeScript, source),
            ["./a", "./b", "../c", "./side-effect", "./types", "pkg"]
        );
    }

    #[test]
    fn finds_reexports_with_a_source() {
        let source = r#"
export { x } from "./x";
export * from "./all";
export * as ns from "./ns";
export const local = 1;
export { local as other };
"#;
        assert_eq!(
            specifiers(SourceKind::TypeScript, source),
            ["./x", "./all", "./ns"]
        );
    }

    #[test]
    fn finds_dynamic_imports_and_require_calls_nested_in_code() {
        let source = r#"
const lazy = () => import("./lazy");
function load() {
  if (x) {
    return require('./cjs');
  }
}
const tpl = import(`./tpl`);
const dynamic = import(`./dyn/${name}`);
const computed = require(name);
other("./not-an-import");
"#;
        assert_eq!(
            specifiers(SourceKind::JavaScript, source),
            ["./lazy", "./cjs", "./tpl"]
        );
    }

    #[test]
    fn finds_import_equals_require_in_typescript() {
        let source = r#"import fs = require("./legacy");"#;
        assert_eq!(specifiers(SourceKind::TypeScript, source), ["./legacy"]);
    }

    #[test]
    fn parses_jsx_and_tsx_syntax() {
        let jsx = "import App from './App';\nexport const x = <App />;";
        assert_eq!(specifiers(SourceKind::JavaScript, jsx), ["./App"]);
        let tsx = "import { A } from './A';\nexport const x = <A<string> prop={1} />;";
        assert_eq!(specifiers(SourceKind::Tsx, tsx), ["./A"]);
    }

    #[test]
    fn ignores_imports_inside_strings_and_comments() {
        let source = "// import x from './commented'\nconst s = \"import y from './string'\";\n";
        assert!(specifiers(SourceKind::TypeScript, source).is_empty());
    }
}
