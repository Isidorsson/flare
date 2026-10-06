mod c_family;
mod csharp;
mod dart;
mod ecmascript;
mod go;
mod jvm;
mod lua;
mod php;
mod python;
mod ruby;
mod rust_lang;
mod sfc;
mod shell;
mod stylesheet;
mod zig;

use std::collections::hash_map::Entry;
use std::collections::HashMap;

use tree_sitter::{Node, Parser};

use super::error::GraphError;
use super::lang::SourceKind;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScriptStep {
    Parent,
    Child(String),
}

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
    LuaModule {
        name: String,
    },
    RobloxPath {
        steps: Vec<ScriptStep>,
    },
    GoImport {
        path: String,
    },
    Include {
        path: String,
    },
    CSharpUsing {
        namespace: String,
        may_be_type: bool,
    },
    JvmImport {
        name: String,
        wildcard: bool,
    },
    RubyRequire {
        path: String,
        relative: bool,
    },
    PhpInclude {
        path: String,
    },
    PhpUse {
        name: String,
    },
    DartImport {
        uri: String,
    },
    ZigImport {
        path: String,
    },
    ShellSource {
        path: String,
    },
    StyleImport {
        path: String,
    },
}

/// A qualified name a file contributes to. Namespaces are C# namespaces and
/// JVM packages; symbols are JVM top-level declarations.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Declared {
    Namespace(String),
    Symbol(String),
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Extraction {
    pub imports: Vec<RawImport>,
    pub declared: Vec<Declared>,
}

impl From<Vec<RawImport>> for Extraction {
    fn from(imports: Vec<RawImport>) -> Self {
        Self {
            imports,
            declared: Vec::new(),
        }
    }
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
    ) -> Result<Extraction, GraphError> {
        match kind {
            SourceKind::Swift => Ok(Extraction::default()),
            SourceKind::Css | SourceKind::Scss | SourceKind::Less => {
                Ok(stylesheet::extract(source).into())
            }
            SourceKind::Vue | SourceKind::Svelte => self.extract_component(path, source),
            _ => self.extract_parsed(kind, path, source),
        }
    }

    fn extract_component(&mut self, path: &str, source: &[u8]) -> Result<Extraction, GraphError> {
        let mut extraction = Extraction::default();
        for block in sfc::script_blocks(source) {
            let script = source.get(block.range).ok_or_else(|| GraphError::Parse {
                path: path.to_string(),
            })?;
            extraction
                .imports
                .extend(self.extract_parsed(block.kind, path, script)?.imports);
        }
        Ok(extraction)
    }

    fn extract_parsed(
        &mut self,
        kind: SourceKind,
        path: &str,
        source: &[u8],
    ) -> Result<Extraction, GraphError> {
        let parse_error = || GraphError::Parse {
            path: path.to_string(),
        };
        let parser = self.parser_for(kind, path)?;
        let tree = parser.parse(source, None).ok_or_else(parse_error)?;
        let root = tree.root_node();
        Ok(match kind {
            SourceKind::TypeScript | SourceKind::Tsx | SourceKind::JavaScript => {
                ecmascript::extract(root, source).into()
            }
            SourceKind::Rust => rust_lang::extract(root, source).into(),
            SourceKind::Python => python::extract(root, source).into(),
            SourceKind::Lua | SourceKind::Luau => lua::extract(root, source).into(),
            SourceKind::Go => go::extract(root, source).into(),
            SourceKind::C | SourceKind::Cpp => c_family::extract(root, source).into(),
            SourceKind::CSharp => csharp::extract(root, source),
            SourceKind::Java => jvm::extract_java(root, source),
            SourceKind::Kotlin => jvm::extract_kotlin(root, source),
            SourceKind::Ruby => ruby::extract(root, source).into(),
            SourceKind::Php => php::extract(root, source).into(),
            SourceKind::Dart => dart::extract(root, source).into(),
            SourceKind::Zig => zig::extract(root, source).into(),
            SourceKind::Shell => shell::extract(root, source).into(),
            SourceKind::Swift
            | SourceKind::Css
            | SourceKind::Scss
            | SourceKind::Less
            | SourceKind::Vue
            | SourceKind::Svelte => Extraction::default(),
        })
    }

    fn parser_for(&mut self, kind: SourceKind, path: &str) -> Result<&mut Parser, GraphError> {
        let parse_error = || GraphError::Parse {
            path: path.to_string(),
        };
        match self.parsers.entry(kind) {
            Entry::Occupied(slot) => Ok(slot.into_mut()),
            Entry::Vacant(slot) => {
                let grammar = kind.grammar().ok_or_else(parse_error)?;
                let mut parser = Parser::new();
                parser.set_language(&grammar).map_err(|_| parse_error())?;
                Ok(slot.insert(parser))
            }
        }
    }
}

pub(super) fn node_text<'a>(node: Node<'_>, source: &'a [u8]) -> &'a str {
    node.utf8_text(source).unwrap_or("")
}

pub(super) fn compact_name(node: Node<'_>, source: &[u8]) -> String {
    node_text(node, source)
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect()
}

pub(super) fn child_of_kind<'t>(node: Node<'t>, kind: &str) -> Option<Node<'t>> {
    let mut cursor = node.walk();
    let found = node
        .children(&mut cursor)
        .find(|child| child.kind() == kind);
    found
}

pub(super) fn strip_quotes(text: &str) -> &str {
    text.get(1..text.len().saturating_sub(1)).unwrap_or("")
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
            .imports
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
        assert_eq!(second.imports.len(), 1);
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

    #[test]
    fn empty_sources_of_every_kind_parse_cleanly() {
        let kinds = [
            SourceKind::Lua,
            SourceKind::Luau,
            SourceKind::Go,
            SourceKind::C,
            SourceKind::Cpp,
            SourceKind::CSharp,
            SourceKind::Java,
            SourceKind::Kotlin,
            SourceKind::Ruby,
            SourceKind::Php,
            SourceKind::Swift,
            SourceKind::Dart,
            SourceKind::Zig,
            SourceKind::Shell,
            SourceKind::Css,
            SourceKind::Scss,
            SourceKind::Less,
            SourceKind::Vue,
            SourceKind::Svelte,
        ];
        for kind in kinds {
            assert_eq!(
                Extractor::new().extract(kind, "empty", b"").unwrap(),
                Extraction::default(),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn swift_files_are_nodes_without_imports() {
        let imports = extract(SourceKind::Swift, "import Foundation\nimport UIKit\n");
        assert!(imports.is_empty());
    }

    #[test]
    fn single_file_components_delegate_to_the_script_grammar() {
        let source =
            "<template><div/></template>\n<script lang=\"ts\">\nimport a from './a';\n</script>\n";
        assert_eq!(
            extract(SourceKind::Vue, source),
            vec![RawImport::Module {
                specifier: "./a".into()
            }]
        );
    }
}
