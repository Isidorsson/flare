use crate::graph::lang::ECMASCRIPT_EXTENSIONS;
use crate::graph::paths;

use super::ResolveContext;

const EMITTED_EXTENSION_SOURCES: [(&str, &[&str]); 4] = [
    (".js", &["ts", "tsx"]),
    (".jsx", &["tsx"]),
    (".mjs", &["mts"]),
    (".cjs", &["cts"]),
];

pub(super) fn resolve(from: &str, specifier: &str, ctx: &ResolveContext<'_>) -> Option<String> {
    let specifier = without_query(specifier);
    if specifier.is_empty() || specifier.contains(':') || specifier.starts_with('/') {
        return None;
    }
    if is_relative(specifier) {
        let base = paths::join(paths::parent(from), specifier)?;
        return probe(&base, ctx.has_file);
    }
    ctx.config
        .aliases
        .candidates(from, specifier)
        .into_iter()
        .chain(ctx.config.packages.candidates(specifier))
        .find_map(|base| probe(&base, ctx.has_file))
}

fn without_query(specifier: &str) -> &str {
    specifier
        .split_once(['?', '#'])
        .map_or(specifier, |(path, _)| path)
}

fn is_relative(specifier: &str) -> bool {
    specifier == "."
        || specifier == ".."
        || specifier.starts_with("./")
        || specifier.starts_with("../")
}

fn probe(base: &str, has_file: &dyn Fn(&str) -> bool) -> Option<String> {
    candidates(base)
        .into_iter()
        .find(|candidate| has_file(candidate))
}

fn candidates(base: &str) -> Vec<String> {
    let mut found = Vec::new();
    for (suffix, sources) in EMITTED_EXTENSION_SOURCES {
        if let Some(stem) = base.strip_suffix(suffix) {
            found.extend(sources.iter().map(|ext| format!("{stem}.{ext}")));
        }
    }
    found.push(base.to_string());
    found.extend(
        ECMASCRIPT_EXTENSIONS
            .iter()
            .map(|ext| format!("{base}.{ext}")),
    );
    found.extend(
        ECMASCRIPT_EXTENSIONS
            .iter()
            .map(|ext| paths::child(base, &format!("index.{ext}"))),
    );
    found
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use crate::graph::resolve::{Declarations, ProjectConfig};

    use super::*;

    fn resolve_in(files: &[&str], from: &str, specifier: &str) -> Option<String> {
        let set: HashSet<String> = files.iter().map(ToString::to_string).collect();
        let has_file = |path: &str| set.contains(path);
        let config = ProjectConfig::default();
        let declared = Declarations::default();
        resolve(
            from,
            specifier,
            &ResolveContext {
                has_file: &has_file,
                config: &config,
                declared: &declared,
            },
        )
    }

    #[test]
    fn query_and_hash_suffixes_from_bundlers_are_ignored() {
        let files = ["src/a.ts", "src/b.js"];
        assert_eq!(
            resolve_in(&files, "src/m.ts", "./a?raw").as_deref(),
            Some("src/a.ts")
        );
        assert_eq!(
            resolve_in(&files, "src/m.ts", "./b.js?url#frag").as_deref(),
            Some("src/b.js")
        );
        assert_eq!(resolve_in(&files, "src/m.ts", "?raw"), None);
    }

    #[test]
    fn resolves_relative_files_by_extension_inference() {
        let files = ["src/a.ts", "src/b.tsx", "src/c.js", "src/d.mjs"];
        assert_eq!(
            resolve_in(&files, "src/main.ts", "./a").as_deref(),
            Some("src/a.ts")
        );
        assert_eq!(
            resolve_in(&files, "src/main.ts", "./b").as_deref(),
            Some("src/b.tsx")
        );
        assert_eq!(
            resolve_in(&files, "src/main.ts", "./c").as_deref(),
            Some("src/c.js")
        );
        assert_eq!(
            resolve_in(&files, "src/main.ts", "./d").as_deref(),
            Some("src/d.mjs")
        );
    }

    #[test]
    fn prefers_typescript_over_javascript_for_the_same_stem() {
        let files = ["src/a.js", "src/a.ts"];
        assert_eq!(
            resolve_in(&files, "src/main.ts", "./a").as_deref(),
            Some("src/a.ts")
        );
    }

    #[test]
    fn resolves_explicit_extensions_and_dotted_names() {
        let files = ["src/a.ts", "src/a.test.ts"];
        assert_eq!(
            resolve_in(&files, "src/m.ts", "./a.ts").as_deref(),
            Some("src/a.ts")
        );
        assert_eq!(
            resolve_in(&files, "src/m.ts", "./a.test").as_deref(),
            Some("src/a.test.ts")
        );
        assert_eq!(resolve_in(&files, "src/m.ts", "./style.css"), None);
    }

    #[test]
    fn maps_emitted_js_extensions_back_to_typescript_sources() {
        let files = [
            "src/a.ts",
            "src/b.tsx",
            "src/c.mts",
            "src/d.cts",
            "src/e.js",
        ];
        assert_eq!(
            resolve_in(&files, "src/m.ts", "./a.js").as_deref(),
            Some("src/a.ts")
        );
        assert_eq!(
            resolve_in(&files, "src/m.ts", "./b.jsx").as_deref(),
            Some("src/b.tsx")
        );
        assert_eq!(
            resolve_in(&files, "src/m.ts", "./c.mjs").as_deref(),
            Some("src/c.mts")
        );
        assert_eq!(
            resolve_in(&files, "src/m.ts", "./d.cjs").as_deref(),
            Some("src/d.cts")
        );
        assert_eq!(
            resolve_in(&files, "src/m.ts", "./e.js").as_deref(),
            Some("src/e.js")
        );
    }

    #[test]
    fn resolves_directories_to_index_files() {
        let files = ["src/ui/index.tsx", "src/lib/index.ts", "index.ts"];
        assert_eq!(
            resolve_in(&files, "src/m.ts", "./ui").as_deref(),
            Some("src/ui/index.tsx")
        );
        assert_eq!(
            resolve_in(&files, "src/m.ts", "./lib/").as_deref(),
            Some("src/lib/index.ts")
        );
        assert_eq!(
            resolve_in(&files, "src/m.ts", "..").as_deref(),
            Some("index.ts")
        );
        assert_eq!(resolve_in(&files, "src/m.ts", ".").as_deref(), None);
    }

    #[test]
    fn resolves_parent_relative_specifiers() {
        let files = ["src/shared/util.ts"];
        assert_eq!(
            resolve_in(&files, "src/features/x/y.ts", "../../shared/util").as_deref(),
            Some("src/shared/util.ts")
        );
    }

    #[test]
    fn ignores_packages_protocols_absolute_paths_and_escapes() {
        let files = ["src/react.ts", "src/a.ts"];
        assert_eq!(resolve_in(&files, "src/m.ts", "react"), None);
        assert_eq!(resolve_in(&files, "src/m.ts", "node:fs"), None);
        assert_eq!(resolve_in(&files, "src/m.ts", "/abs/a"), None);
        assert_eq!(resolve_in(&files, "src/m.ts", "../../../outside"), None);
        assert_eq!(resolve_in(&files, "src/m.ts", ""), None);
    }
}
