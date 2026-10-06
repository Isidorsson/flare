use std::collections::HashMap;

use crate::graph::extract::Declared;
use crate::graph::lang::SourceKind;
use crate::graph::paths;

const GO_TEST_SUFFIX: &str = "_test.go";

pub struct DeclaredFile<'a> {
    pub path: &'a str,
    pub kind: SourceKind,
    pub declared: &'a [Declared],
}

type Index = HashMap<String, Vec<String>>;

/// Lookups that depend on what other files declare rather than on their paths:
/// C# namespaces, JVM packages and symbols, and Go package directories. Built
/// from the file list in path order, so every bucket is sorted.
#[derive(Debug, Default)]
pub struct Declarations {
    dotnet_namespaces: Index,
    jvm_packages: Index,
    jvm_symbols: Index,
    go_packages: Index,
}

impl Declarations {
    pub fn build<'a>(files: impl Iterator<Item = DeclaredFile<'a>>) -> Self {
        let mut declarations = Self::default();
        for file in files {
            match file.kind {
                SourceKind::CSharp => declarations.add_dotnet(&file),
                SourceKind::Java | SourceKind::Kotlin => declarations.add_jvm(&file),
                SourceKind::Go if !file.path.ends_with(GO_TEST_SUFFIX) => {
                    push(
                        &mut declarations.go_packages,
                        paths::parent(file.path),
                        file.path,
                    );
                }
                _ => {}
            }
        }
        declarations
    }

    pub fn dotnet_namespace(&self, name: &str) -> &[String] {
        lookup(&self.dotnet_namespaces, name)
    }

    pub fn jvm_package(&self, name: &str) -> &[String] {
        lookup(&self.jvm_packages, name)
    }

    pub fn jvm_symbol(&self, name: &str) -> &[String] {
        lookup(&self.jvm_symbols, name)
    }

    pub fn go_package(&self, dir: &str) -> &[String] {
        lookup(&self.go_packages, dir)
    }

    fn add_dotnet(&mut self, file: &DeclaredFile<'_>) {
        for declared in file.declared {
            if let Declared::Namespace(name) = declared {
                push(&mut self.dotnet_namespaces, name, file.path);
            }
        }
    }

    fn add_jvm(&mut self, file: &DeclaredFile<'_>) {
        for declared in file.declared {
            match declared {
                Declared::Namespace(name) => push(&mut self.jvm_packages, name, file.path),
                Declared::Symbol(name) => push(&mut self.jvm_symbols, name, file.path),
            }
        }
    }
}

fn push(index: &mut Index, key: &str, path: &str) {
    index
        .entry(key.to_string())
        .or_default()
        .push(path.to_string());
}

fn lookup<'a>(index: &'a Index, key: &str) -> &'a [String] {
    index.get(key).map_or(&[], Vec::as_slice)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn declared(
        path: &'static str,
        kind: SourceKind,
        names: Vec<Declared>,
    ) -> (String, SourceKind, Vec<Declared>) {
        (path.to_string(), kind, names)
    }

    fn build(files: &[(String, SourceKind, Vec<Declared>)]) -> Declarations {
        Declarations::build(files.iter().map(|(path, kind, names)| DeclaredFile {
            path,
            kind: *kind,
            declared: names,
        }))
    }

    #[test]
    fn groups_files_by_namespace_package_symbol_and_go_directory() {
        let files = [
            declared(
                "a/X.cs",
                SourceKind::CSharp,
                vec![Declared::Namespace("App.Models".into())],
            ),
            declared(
                "b/Y.cs",
                SourceKind::CSharp,
                vec![Declared::Namespace("App.Models".into())],
            ),
            declared(
                "j/Z.java",
                SourceKind::Java,
                vec![
                    Declared::Namespace("p".into()),
                    Declared::Symbol("p.Z".into()),
                ],
            ),
            declared("g/a.go", SourceKind::Go, Vec::new()),
            declared("g/a_test.go", SourceKind::Go, Vec::new()),
            declared("g/b.go", SourceKind::Go, Vec::new()),
        ];
        let index = build(&files);
        assert_eq!(index.dotnet_namespace("App.Models"), ["a/X.cs", "b/Y.cs"]);
        assert_eq!(index.jvm_package("p"), ["j/Z.java"]);
        assert_eq!(index.jvm_symbol("p.Z"), ["j/Z.java"]);
        assert_eq!(index.go_package("g"), ["g/a.go", "g/b.go"]);
        assert!(index.dotnet_namespace("p").is_empty());
        assert!(index.jvm_package("App.Models").is_empty());
    }

    #[test]
    fn namespaces_of_other_languages_do_not_leak_between_families() {
        let files = [declared(
            "k/A.kt",
            SourceKind::Kotlin,
            vec![Declared::Namespace("x".into())],
        )];
        let index = build(&files);
        assert!(index.dotnet_namespace("x").is_empty());
        assert_eq!(index.jvm_package("x"), ["k/A.kt"]);
    }
}
