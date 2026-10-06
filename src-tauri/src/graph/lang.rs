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
    Lua,
    Luau,
    Go,
    C,
    Cpp,
    CSharp,
    Java,
    Kotlin,
    Ruby,
    Php,
    Swift,
    Dart,
    Zig,
    Shell,
    Css,
    Scss,
    Less,
    Vue,
    Svelte,
}

const EXTENSIONS: [(&str, SourceKind); 38] = [
    ("ts", SourceKind::TypeScript),
    ("mts", SourceKind::TypeScript),
    ("cts", SourceKind::TypeScript),
    ("tsx", SourceKind::Tsx),
    ("js", SourceKind::JavaScript),
    ("jsx", SourceKind::JavaScript),
    ("mjs", SourceKind::JavaScript),
    ("cjs", SourceKind::JavaScript),
    ("rs", SourceKind::Rust),
    ("py", SourceKind::Python),
    ("lua", SourceKind::Lua),
    ("luau", SourceKind::Luau),
    ("go", SourceKind::Go),
    ("c", SourceKind::C),
    ("h", SourceKind::C),
    ("cc", SourceKind::Cpp),
    ("cpp", SourceKind::Cpp),
    ("cxx", SourceKind::Cpp),
    ("hpp", SourceKind::Cpp),
    ("hh", SourceKind::Cpp),
    ("hxx", SourceKind::Cpp),
    ("cs", SourceKind::CSharp),
    ("java", SourceKind::Java),
    ("kt", SourceKind::Kotlin),
    ("kts", SourceKind::Kotlin),
    ("rb", SourceKind::Ruby),
    ("php", SourceKind::Php),
    ("swift", SourceKind::Swift),
    ("dart", SourceKind::Dart),
    ("zig", SourceKind::Zig),
    ("sh", SourceKind::Shell),
    ("bash", SourceKind::Shell),
    ("zsh", SourceKind::Shell),
    ("css", SourceKind::Css),
    ("scss", SourceKind::Scss),
    ("less", SourceKind::Less),
    ("vue", SourceKind::Vue),
    ("svelte", SourceKind::Svelte),
];

impl SourceKind {
    pub fn from_path(path: &str) -> Option<Self> {
        let extension = paths::extension(path)?;
        EXTENSIONS
            .iter()
            .find(|(candidate, _)| *candidate == extension)
            .map(|(_, kind)| *kind)
    }

    pub fn language(self) -> Language {
        match self {
            Self::TypeScript | Self::Tsx => Language::TypeScript,
            Self::JavaScript => Language::JavaScript,
            Self::Rust => Language::Rust,
            Self::Python => Language::Python,
            Self::Lua => Language::Lua,
            Self::Luau => Language::Luau,
            Self::Go => Language::Go,
            Self::C => Language::C,
            Self::Cpp => Language::Cpp,
            Self::CSharp => Language::CSharp,
            Self::Java => Language::Java,
            Self::Kotlin => Language::Kotlin,
            Self::Ruby => Language::Ruby,
            Self::Php => Language::Php,
            Self::Swift => Language::Swift,
            Self::Dart => Language::Dart,
            Self::Zig => Language::Zig,
            Self::Shell => Language::Shell,
            Self::Css | Self::Scss | Self::Less => Language::Css,
            Self::Vue => Language::Vue,
            Self::Svelte => Language::Svelte,
        }
    }

    /// `None` for kinds that are indexed without a tree-sitter parse: Swift has
    /// no file-level imports, stylesheets and single-file components use scanners.
    pub fn grammar(self) -> Option<Grammar> {
        Some(match self {
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Self::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::Python => tree_sitter_python::LANGUAGE.into(),
            Self::Lua => tree_sitter_lua::LANGUAGE.into(),
            Self::Luau => tree_sitter_luau::LANGUAGE.into(),
            Self::Go => tree_sitter_go::LANGUAGE.into(),
            Self::C => tree_sitter_c::LANGUAGE.into(),
            Self::Cpp => tree_sitter_cpp::LANGUAGE.into(),
            Self::CSharp => tree_sitter_c_sharp::LANGUAGE.into(),
            Self::Java => tree_sitter_java::LANGUAGE.into(),
            Self::Kotlin => tree_sitter_kotlin_ng::LANGUAGE.into(),
            Self::Ruby => tree_sitter_ruby::LANGUAGE.into(),
            Self::Php => tree_sitter_php::LANGUAGE_PHP.into(),
            Self::Dart => tree_sitter_dart::LANGUAGE.into(),
            Self::Zig => tree_sitter_zig::LANGUAGE.into(),
            Self::Shell => tree_sitter_bash::LANGUAGE.into(),
            Self::Swift | Self::Css | Self::Scss | Self::Less | Self::Vue | Self::Svelte => {
                return None;
            }
        })
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
            ("a.lua", Some(SourceKind::Lua)),
            ("a.luau", Some(SourceKind::Luau)),
            ("a.go", Some(SourceKind::Go)),
            ("a.c", Some(SourceKind::C)),
            ("a.h", Some(SourceKind::C)),
            ("a.cc", Some(SourceKind::Cpp)),
            ("a.cpp", Some(SourceKind::Cpp)),
            ("a.cxx", Some(SourceKind::Cpp)),
            ("a.hpp", Some(SourceKind::Cpp)),
            ("a.hh", Some(SourceKind::Cpp)),
            ("a.cs", Some(SourceKind::CSharp)),
            ("a.java", Some(SourceKind::Java)),
            ("a.kt", Some(SourceKind::Kotlin)),
            ("build.gradle.kts", Some(SourceKind::Kotlin)),
            ("a.rb", Some(SourceKind::Ruby)),
            ("a.php", Some(SourceKind::Php)),
            ("a.swift", Some(SourceKind::Swift)),
            ("a.dart", Some(SourceKind::Dart)),
            ("a.zig", Some(SourceKind::Zig)),
            ("a.sh", Some(SourceKind::Shell)),
            ("a.bash", Some(SourceKind::Shell)),
            ("a.css", Some(SourceKind::Css)),
            ("a.scss", Some(SourceKind::Scss)),
            ("a.less", Some(SourceKind::Less)),
            ("a.vue", Some(SourceKind::Vue)),
            ("a.svelte", Some(SourceKind::Svelte)),
            ("a.json", None),
            ("Makefile", None),
            (".ts", None),
        ];
        for (path, expected) in cases {
            assert_eq!(SourceKind::from_path(path), expected, "{path}");
        }
    }

    #[test]
    fn the_extension_table_lists_every_extension_once() {
        let mut seen = std::collections::HashSet::new();
        for (extension, _) in EXTENSIONS {
            assert!(seen.insert(extension), "{extension} is listed twice");
        }
    }

    #[test]
    fn dialects_share_a_language_label() {
        assert_eq!(SourceKind::Tsx.language(), Language::TypeScript);
        assert_eq!(SourceKind::JavaScript.language(), Language::JavaScript);
        assert_eq!(SourceKind::Scss.language(), Language::Css);
        assert_eq!(SourceKind::Less.language(), Language::Css);
        assert_eq!(SourceKind::Luau.language(), Language::Luau);
    }

    #[test]
    fn every_grammar_is_compatible_with_the_linked_tree_sitter() {
        for (extension, kind) in EXTENSIONS {
            let Some(grammar) = kind.grammar() else {
                continue;
            };
            let mut parser = tree_sitter::Parser::new();
            parser
                .set_language(&grammar)
                .unwrap_or_else(|error| panic!("{extension}: {error}"));
        }
    }

    #[test]
    fn parserless_kinds_are_exactly_the_scanned_and_node_only_ones() {
        let parserless: Vec<SourceKind> = EXTENSIONS
            .iter()
            .map(|(_, kind)| *kind)
            .filter(|kind| kind.grammar().is_none())
            .collect();
        assert!(parserless.contains(&SourceKind::Swift));
        assert!(parserless.contains(&SourceKind::Vue));
        assert!(!parserless.contains(&SourceKind::Go));
    }
}
