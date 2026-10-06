mod ecmascript;
mod python;
mod rust_lang;

use std::collections::hash_map::Entry;
use std::collections::HashMap;

use tree_sitter::{Node, Parser};

use super::error::GraphError;
use super::lang::SourceKind;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RawImport {
    Module {
        specifier: String,
    },
    RustMod {
        name: String,
        inline: Vec<String>,
    },
    RustUse {
        path: Vec<String>,
        inline: Vec<String>,
    },
    Python {
        level: usize,
        module: Vec<String>,
        names: Vec<String>,
    },
}

#[derive(Default)]
pub struct Extractor {
    parsers: HashMap<SourceKind, Parser>,
}

impl Extractor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn extract(
        &mut self,
        kind: SourceKind,
        path: &str,
        source: &[u8],
    ) -> Result<Vec<RawImport>, GraphError> {
        let parse_error = || GraphError::Parse {
            path: path.to_string(),
        };
        let parser = self.parser_for(kind, path)?;
        let tree = parser.parse(source, None).ok_or_else(parse_error)?;
        let root = tree.root_node();
        Ok(match kind {
            SourceKind::TypeScript | SourceKind::Tsx | SourceKind::JavaScript => {
                ecmascript::extract(root, source)
            }
            SourceKind::Rust => rust_lang::extract(root, source),
            SourceKind::Python => python::extract(root, source),
        })
    }

    fn parser_for(&mut self, kind: SourceKind, path: &str) -> Result<&mut Parser, GraphError> {
        match self.parsers.entry(kind) {
            Entry::Occupied(slot) => Ok(slot.into_mut()),
            Entry::Vacant(slot) => {
                let mut parser = Parser::new();
                parser
                    .set_language(&kind.grammar())
                    .map_err(|_| GraphError::Parse {
                        path: path.to_string(),
                    })?;
                Ok(slot.insert(parser))
            }
        }
    }
}

pub(super) fn node_text<'a>(node: Node<'_>, source: &'a [u8]) -> &'a str {
    node.utf8_text(source).unwrap_or("")
}

pub(super) fn walk_tree<'t>(
    root: Node<'t>,
    scope_of: impl Fn(Node<'t>, &[u8]) -> Option<String>,
    source: &[u8],
    mut visit: impl FnMut(Node<'t>, &[String]),
) {
    let mut cursor = root.walk();
    let mut scopes: Vec<String> = Vec::new();
    let mut pushed: Vec<bool> = Vec::new();
    loop {
        let node = cursor.node();
        visit(node, &scopes);
        if cursor.goto_first_child() {
            let scope = scope_of(node, source);
            pushed.push(scope.is_some());
            scopes.extend(scope);
            continue;
        }
        loop {
            if cursor.goto_next_sibling() {
                break;
            }
            if !cursor.goto_parent() {
                return;
            }
            if pushed.pop() == Some(true) {
                scopes.pop();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extract(kind: SourceKind, source: &str) -> Vec<RawImport> {
        Extractor::new()
            .extract(kind, "test", source.as_bytes())
            .unwrap()
    }

    #[test]
    fn reuses_one_parser_per_kind_across_files() {
        let mut extractor = Extractor::new();
        extractor
            .extract(SourceKind::Python, "a.py", b"import os")
            .unwrap();
        let second = extractor
            .extract(SourceKind::Python, "b.py", b"import sys")
            .unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(extractor.parsers.len(), 1);
    }

    #[test]
    fn tolerates_syntax_errors_and_extracts_what_it_can() {
        let imports = extract(
            SourceKind::TypeScript,
            "import a from './a';\nconst = = ;\n",
        );
        assert_eq!(
            imports,
            vec![RawImport::Module {
                specifier: "./a".into()
            }]
        );
    }

    #[test]
    fn empty_sources_have_no_imports() {
        assert!(extract(SourceKind::Rust, "").is_empty());
    }
}
