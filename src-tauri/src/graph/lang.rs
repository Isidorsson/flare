use tree_sitter::Language as Grammar;

use super::model::Language;
use super::paths;

pub const ECMASCRIPT_EXTENSIONS: [&str; 8] = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SourceKind {
    TypeScript,
    Tsx,
    JavaScript,
    Rust,
    Python,
}

impl SourceKind {
    pub fn from_path(path: &str) -> Option<Self> {
        match paths::extension(path)? {
            "ts" | "mts" | "cts" => Some(Self::TypeScript),
            "tsx" => Some(Self::Tsx),
            "js" | "jsx" | "mjs" | "cjs" => Some(Self::JavaScript),
            "rs" => Some(Self::Rust),
            "py" => Some(Self::Python),
            _ => None,
        }
    }

    pub fn language(self) -> Language {
        match self {
            Self::TypeScript | Self::Tsx => Language::TypeScript,
            Self::JavaScript => Language::JavaScript,
            Self::Rust => Language::Rust,
            Self::Python => Language::Python,
        }
    }

    pub fn grammar(self) -> Grammar {
        match self {
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Self::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::Python => tree_sitter_python::LANGUAGE.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_the_kind_from_the_extension() {
        let cases = [
            ("a.ts", Some(SourceKind::TypeScript)),
            ("a.d.ts", Some(SourceKind::TypeScript)),
            ("a.mts", Some(SourceKind::TypeScript)),
            ("a.tsx", Some(SourceKind::Tsx)),
            ("a.js", Some(SourceKind::JavaScript)),
            ("a.jsx", Some(SourceKind::JavaScript)),
            ("a.cjs", Some(SourceKind::JavaScript)),
            ("a.rs", Some(SourceKind::Rust)),
            ("a.py", Some(SourceKind::Python)),
            ("a.json", None),
            ("Makefile", None),
            (".ts", None),
        ];
        for (path, expected) in cases {
            assert_eq!(SourceKind::from_path(path), expected, "{path}");
        }
    }

    #[test]
    fn tsx_and_ts_share_a_language_label() {
        assert_eq!(SourceKind::Tsx.language(), Language::TypeScript);
        assert_eq!(SourceKind::JavaScript.language(), Language::JavaScript);
    }

    #[test]
    fn every_grammar_is_compatible_with_the_linked_tree_sitter() {
        let kinds = [
            SourceKind::TypeScript,
            SourceKind::Tsx,
            SourceKind::JavaScript,
            SourceKind::Rust,
            SourceKind::Python,
        ];
        for kind in kinds {
            let mut parser = tree_sitter::Parser::new();
            parser.set_language(&kind.grammar()).unwrap();
        }
    }
}
