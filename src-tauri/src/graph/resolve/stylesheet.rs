use crate::graph::lang::SourceKind;
use crate::graph::paths;

type HasFile<'a> = &'a dyn Fn(&str) -> bool;

const SASS_EXTENSIONS: [&str; 3] = ["scss", "sass", "css"];
const LESS_EXTENSIONS: [&str; 2] = ["less", "css"];
const INDEX_STEM: &str = "index";
const PARTIAL_PREFIX: &str = "_";

/// Targets are relative to the importing file. Plain CSS needs the exact file;
/// Sass and Less infer the extension, and Sass also tries `_partial` files and
/// `index` files. Anything with a scheme (`sass:math`, `https:`) is external.
pub(super) fn resolve(
    from: &str,
    kind: SourceKind,
    target: &str,
    has_file: HasFile<'_>,
) -> Option<String> {
    if target.contains("#{") {
        return None;
    }
    let target = target.split(['?', '#']).next().unwrap_or("");
    if target.is_empty()
        || target.contains(':')
        || target.starts_with('/')
        || target.starts_with('~')
    {
        return None;
    }
    let base = paths::join(paths::parent(from), target)?;
    candidates(&base, kind)
        .into_iter()
        .find(|candidate| has_file(candidate))
}

fn candidates(base: &str, kind: SourceKind) -> Vec<String> {
    let extensions: &[&str] = match kind {
        SourceKind::Scss => &SASS_EXTENSIONS,
        SourceKind::Less => &LESS_EXTENSIONS,
        _ => return vec![base.to_string()],
    };
    let sass = kind == SourceKind::Scss;
    let mut found = vec![base.to_string()];
    found.extend(extensions.iter().map(|ext| format!("{base}.{ext}")));
    if sass {
        found.extend(partials_of(base, extensions));
        found.extend(extensions.iter().flat_map(|ext| index_files(base, ext)));
    }
    found
}

fn partials_of(base: &str, extensions: &[&str]) -> Vec<String> {
    let dir = paths::parent(base);
    let name = paths::file_name(base);
    let partial = paths::child(dir, &format!("{PARTIAL_PREFIX}{name}"));
    let mut found = vec![partial.clone()];
    found.extend(extensions.iter().map(|ext| format!("{partial}.{ext}")));
    found
}

fn index_files(base: &str, ext: &str) -> Vec<String> {
    vec![
        paths::child(base, &format!("{INDEX_STEM}.{ext}")),
        paths::child(base, &format!("{PARTIAL_PREFIX}{INDEX_STEM}.{ext}")),
    ]
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn run(files: &[&str], from: &str, kind: SourceKind, target: &str) -> Option<String> {
        let set: HashSet<String> = files.iter().map(ToString::to_string).collect();
        resolve(from, kind, target, &|path| set.contains(path))
    }

    #[test]
    fn css_imports_need_the_exact_relative_file() {
        let files = ["css/base.css", "css/theme/dark.css"];
        assert_eq!(
            run(&files, "css/app.css", SourceKind::Css, "base.css").as_deref(),
            Some("css/base.css")
        );
        assert_eq!(
            run(&files, "css/app.css", SourceKind::Css, "./theme/dark.css").as_deref(),
            Some("css/theme/dark.css")
        );
        assert_eq!(run(&files, "css/app.css", SourceKind::Css, "base"), None);
    }

    #[test]
    fn sass_infers_extensions_partials_and_index_files() {
        let files = [
            "s/_vars.scss",
            "s/mixins.scss",
            "s/lib/_index.scss",
            "s/plain.css",
        ];
        let find = |target: &str| run(&files, "s/main.scss", SourceKind::Scss, target);
        assert_eq!(find("vars").as_deref(), Some("s/_vars.scss"));
        assert_eq!(find("mixins").as_deref(), Some("s/mixins.scss"));
        assert_eq!(find("lib").as_deref(), Some("s/lib/_index.scss"));
        assert_eq!(find("plain.css").as_deref(), Some("s/plain.css"));
        assert_eq!(find("vars.scss").as_deref(), Some("s/_vars.scss"));
    }

    #[test]
    fn less_infers_its_extension_but_has_no_partials() {
        let files = ["l/mixins.less", "l/_hidden.less"];
        let find = |target: &str| run(&files, "l/main.less", SourceKind::Less, target);
        assert_eq!(find("mixins").as_deref(), Some("l/mixins.less"));
        assert_eq!(find("hidden"), None);
    }

    #[test]
    fn external_and_computed_targets_are_skipped() {
        let files = ["a.scss"];
        for target in [
            "sass:math",
            "https://x/y.css",
            "//cdn/x.css",
            "~pkg/x",
            "a#{b}",
            "/abs.scss",
            "",
        ] {
            assert_eq!(
                run(&files, "m.scss", SourceKind::Scss, target),
                None,
                "{target}"
            );
        }
    }

    #[test]
    fn query_strings_are_ignored() {
        assert_eq!(
            run(&["a.css"], "m.css", SourceKind::Css, "a.css?v=1").as_deref(),
            Some("a.css")
        );
    }
}
