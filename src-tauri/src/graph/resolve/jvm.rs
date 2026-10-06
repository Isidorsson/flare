use crate::graph::paths;

use super::declared::Declarations;

type HasFile<'a> = &'a dyn Fn(&str) -> bool;

const SOURCE_ROOTS: [&str; 4] = ["src/main/java", "src/main/kotlin", "src", ""];
const SOURCE_EXTENSIONS: [&str; 2] = ["java", "kt"];

/// Names are matched against what files declare (their package and top-level
/// symbols), which finds the source root of any layout. Only when that finds
/// nothing are the conventional source roots probed for `a/b/C.java|kt`.
pub(super) fn resolve(
    from: &str,
    name: &str,
    wildcard: bool,
    declared: &Declarations,
    has_file: HasFile<'_>,
) -> Vec<String> {
    if wildcard {
        return wildcard_files(name, declared);
    }
    let by_symbol = symbol_files(name, declared);
    if !by_symbol.is_empty() {
        return by_symbol;
    }
    probe_source_roots(from, name, has_file)
        .into_iter()
        .collect()
}

fn wildcard_files(name: &str, declared: &Declarations) -> Vec<String> {
    let package = declared.jvm_package(name);
    if package.is_empty() {
        declared.jvm_symbol(name).to_vec()
    } else {
        package.to_vec()
    }
}

/// `a.b.C.Inner` and `a.b.C.member` (static imports) both belong to `a.b.C`.
fn symbol_files(name: &str, declared: &Declarations) -> Vec<String> {
    let mut candidate = name;
    loop {
        let files = declared.jvm_symbol(candidate);
        if !files.is_empty() {
            return files.to_vec();
        }
        match candidate.rsplit_once('.') {
            Some((outer, _)) if outer.contains('.') => candidate = outer,
            _ => return Vec::new(),
        }
    }
}

fn probe_source_roots(from: &str, name: &str, has_file: HasFile<'_>) -> Option<String> {
    let owners = owner_paths(name);
    source_bases(from).iter().find_map(|base| {
        owners.iter().find_map(|owner| {
            SOURCE_EXTENSIONS.iter().find_map(|ext| {
                let candidate = paths::join(base, &format!("{owner}.{ext}"))?;
                has_file(&candidate).then_some(candidate)
            })
        })
    })
}

fn owner_paths(name: &str) -> Vec<String> {
    let segments: Vec<&str> = name.split('.').collect();
    (2..=segments.len())
        .rev()
        .map(|len| segments[..len].join("/"))
        .collect()
}

fn source_bases(from: &str) -> Vec<String> {
    paths::ancestor_dirs(paths::parent(from))
        .into_iter()
        .flat_map(|dir| {
            SOURCE_ROOTS.iter().map(move |root| {
                if root.is_empty() {
                    dir.to_string()
                } else {
                    paths::child(dir, root)
                }
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use crate::graph::extract::Declared;
    use crate::graph::lang::SourceKind;
    use crate::graph::resolve::declared::DeclaredFile;

    use super::*;

    struct Source {
        path: &'static str,
        kind: SourceKind,
        declared: Vec<Declared>,
    }

    fn source(path: &'static str, package: &str, symbols: &[&str]) -> Source {
        let mut declared = vec![Declared::Namespace(package.into())];
        declared.extend(
            symbols
                .iter()
                .map(|name| Declared::Symbol(format!("{package}.{name}"))),
        );
        let kind = if path.ends_with(".kt") {
            SourceKind::Kotlin
        } else {
            SourceKind::Java
        };
        Source {
            path,
            kind,
            declared,
        }
    }

    fn run(
        sources: &[Source],
        extra: &[&str],
        from: &str,
        name: &str,
        wildcard: bool,
    ) -> Vec<String> {
        let index = Declarations::build(sources.iter().map(|source| DeclaredFile {
            path: source.path,
            kind: source.kind,
            declared: &source.declared,
        }));
        let files: HashSet<&str> = sources
            .iter()
            .map(|source| source.path)
            .chain(extra.iter().copied())
            .collect();
        resolve(from, name, wildcard, &index, &|path| files.contains(path))
    }

    #[test]
    fn resolves_a_class_import_through_its_declared_package() {
        let sources = [source("app/src/main/java/a/b/C.java", "a.b", &["C"])];
        assert_eq!(
            run(&sources, &[], "app/Main.java", "a.b.C", false),
            ["app/src/main/java/a/b/C.java"]
        );
    }

    #[test]
    fn nested_class_and_static_member_imports_belong_to_the_outer_class() {
        let sources = [source("a/b/C.java", "a.b", &["C"])];
        for name in ["a.b.C.Inner", "a.b.C.method"] {
            assert_eq!(
                run(&sources, &[], "x/Y.java", name, false),
                ["a/b/C.java"],
                "{name}"
            );
        }
    }

    #[test]
    fn kotlin_top_level_symbols_resolve_to_their_file() {
        let sources = [source("k/Utils.kt", "k.util", &["helper", "Utils"])];
        assert_eq!(
            run(&sources, &[], "m/Main.kt", "k.util.helper", false),
            ["k/Utils.kt"]
        );
    }

    #[test]
    fn wildcards_link_every_file_of_the_package() {
        let sources = [
            source("a/b/One.java", "a.b", &["One"]),
            source("a/b/Two.kt", "a.b", &["Two"]),
        ];
        assert_eq!(
            run(&sources, &[], "m/Main.java", "a.b", true),
            ["a/b/One.java", "a/b/Two.kt"]
        );
    }

    #[test]
    fn a_package_import_is_not_a_prefix_match_for_unknown_classes() {
        let sources = [source("a/b/One.java", "a.b", &["One"])];
        assert!(run(&sources, &[], "m/Main.java", "a.b.External", false).is_empty());
        assert!(run(&sources, &[], "m/Main.java", "java.util.List", false).is_empty());
    }

    #[test]
    fn falls_back_to_conventional_source_roots_for_files_without_a_package() {
        let extra = ["svc/src/main/kotlin/org/x/Thing.kt", "lib/org/y/Other.java"];
        assert_eq!(
            run(
                &[],
                &extra,
                "svc/src/main/java/Main.java",
                "org.x.Thing",
                false
            ),
            ["svc/src/main/kotlin/org/x/Thing.kt"]
        );
        assert_eq!(
            run(&[], &extra, "lib/Main.java", "org.y.Other.Inner", false),
            ["lib/org/y/Other.java"]
        );
    }
}
