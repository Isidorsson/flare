use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::graph::paths;

const MAX_EXTENDS_DEPTH: usize = 5;

pub fn is_config_file(rel: &str) -> bool {
    let name = paths::file_name(rel);
    let stem = name
        .strip_prefix("tsconfig")
        .or_else(|| name.strip_prefix("jsconfig"));
    stem.is_some_and(|rest| rest == ".json" || (rest.starts_with('.') && rest.ends_with(".json")))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct AliasRule {
    pub(super) prefix: String,
    suffix: String,
    wildcard: bool,
    pub(super) targets: Vec<String>,
}

impl AliasRule {
    pub(super) fn parse(pattern: &str, targets: Vec<String>) -> Option<Self> {
        let (prefix, suffix, wildcard) = match pattern.split_once('*') {
            None => (pattern, "", false),
            Some((_, rest)) if rest.contains('*') => return None,
            Some((prefix, suffix)) => (prefix, suffix, true),
        };
        Some(Self {
            prefix: prefix.to_string(),
            suffix: suffix.to_string(),
            wildcard,
            targets,
        })
    }

    pub(super) fn capture<'a>(&self, specifier: &'a str) -> Option<&'a str> {
        if !self.wildcard {
            return (specifier == self.prefix).then_some("");
        }
        specifier
            .strip_prefix(self.prefix.as_str())?
            .strip_suffix(self.suffix.as_str())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct RawConfig {
    base_url: Option<String>,
    paths: Option<(String, Vec<AliasRule>)>,
}

impl RawConfig {
    fn overridden_by(self, child: RawConfig) -> RawConfig {
        RawConfig {
            base_url: child.base_url.or(self.base_url),
            paths: child.paths.or(self.paths),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AliasScope {
    dir: String,
    config: RawConfig,
}

impl AliasScope {
    fn covers(&self, dir: &str) -> bool {
        self.dir.is_empty() || dir == self.dir || dir.starts_with(&format!("{}/", self.dir))
    }

    fn push_candidates(&self, specifier: &str, out: &mut Vec<String>) {
        if let Some((paths_dir, rules)) = &self.config.paths {
            let target_base = self.config.base_url.as_deref().unwrap_or(paths_dir);
            let best = rules
                .iter()
                .filter_map(|rule| rule.capture(specifier).map(|captured| (rule, captured)))
                .max_by_key(|(rule, _)| rule.prefix.len());
            if let Some((rule, captured)) = best {
                for target in &rule.targets {
                    out.extend(paths::join(target_base, &target.replace('*', captured)));
                }
            }
        }
        if let Some(base_url) = &self.config.base_url {
            out.extend(paths::join(base_url, specifier));
        }
    }
}

#[derive(Debug, Default)]
pub struct AliasScopes {
    scopes: Vec<AliasScope>,
}

impl AliasScopes {
    pub fn load(root: &Path, config_files: &[String]) -> (Self, Vec<String>) {
        let mut warnings = Vec::new();
        let mut by_dir: BTreeMap<String, RawConfig> = BTreeMap::new();
        for file in config_files {
            let config = load_config(root, file, 0, &mut warnings);
            if config == RawConfig::default() {
                continue;
            }
            let slot = by_dir.entry(paths::parent(file).to_string()).or_default();
            *slot = std::mem::take(slot).overridden_by(config);
        }
        let mut scopes: Vec<AliasScope> = by_dir
            .into_iter()
            .map(|(dir, config)| AliasScope { dir, config })
            .collect();
        scopes.sort_by_key(|scope| std::cmp::Reverse(scope.dir.len()));
        (Self { scopes }, warnings)
    }

    pub fn candidates(&self, from: &str, specifier: &str) -> Vec<String> {
        let from_dir = paths::parent(from);
        let mut found = Vec::new();
        for scope in self.scopes.iter().filter(|scope| scope.covers(from_dir)) {
            scope.push_candidates(specifier, &mut found);
        }
        found
    }
}

fn load_config(root: &Path, file: &str, depth: usize, warnings: &mut Vec<String>) -> RawConfig {
    let text = match fs::read_to_string(root.join(file)) {
        Ok(text) => text,
        Err(error) => {
            warnings.push(format!("{file}: cannot read ({error})"));
            return RawConfig::default();
        }
    };
    let json: Value = match serde_json::from_str(&strip_jsonc(&text)) {
        Ok(json) => json,
        Err(error) => {
            warnings.push(format!("{file}: invalid JSON ({error})"));
            return RawConfig::default();
        }
    };
    let inherited = load_extended(root, file, &json, depth, warnings);
    inherited.overridden_by(own_settings(file, &json, warnings))
}

fn load_extended(
    root: &Path,
    file: &str,
    json: &Value,
    depth: usize,
    warnings: &mut Vec<String>,
) -> RawConfig {
    let targets: Vec<&str> = match json.get("extends") {
        Some(Value::String(single)) => vec![single.as_str()],
        Some(Value::Array(many)) => many.iter().filter_map(Value::as_str).collect(),
        _ => return RawConfig::default(),
    };
    if depth >= MAX_EXTENDS_DEPTH {
        warnings.push(format!(
            "{file}: extends chain is deeper than {MAX_EXTENDS_DEPTH}"
        ));
        return RawConfig::default();
    }
    let mut merged = RawConfig::default();
    for target in targets.into_iter().filter(|target| target.starts_with('.')) {
        let with_extension = if target.ends_with(".json") {
            target.to_string()
        } else {
            format!("{target}.json")
        };
        let Some(extended) = paths::join(paths::parent(file), &with_extension) else {
            warnings.push(format!("{file}: extends {target} leaves the workspace"));
            continue;
        };
        merged = merged.overridden_by(load_config(root, &extended, depth + 1, warnings));
    }
    merged
}

fn own_settings(file: &str, json: &Value, warnings: &mut Vec<String>) -> RawConfig {
    let dir = paths::parent(file);
    let options = json.get("compilerOptions");
    let base_url = options
        .and_then(|options| options.get("baseUrl"))
        .and_then(Value::as_str)
        .and_then(|base| {
            let joined = paths::join(dir, base);
            if joined.is_none() {
                warnings.push(format!("{file}: baseUrl {base} leaves the workspace"));
            }
            joined
        });
    let rules = options
        .and_then(|options| options.get("paths"))
        .and_then(Value::as_object)
        .map(|object| parse_paths(file, object, warnings));
    RawConfig {
        base_url,
        paths: rules.map(|rules| (dir.to_string(), rules)),
    }
}

fn parse_paths(
    file: &str,
    object: &serde_json::Map<String, Value>,
    warnings: &mut Vec<String>,
) -> Vec<AliasRule> {
    let mut rules = Vec::new();
    for (pattern, targets) in object {
        let targets: Vec<String> = targets
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        match AliasRule::parse(pattern, targets) {
            Some(rule) => rules.push(rule),
            None => warnings.push(format!(
                "{file}: paths pattern {pattern} has more than one *"
            )),
        }
    }
    rules
}

pub fn strip_jsonc(input: &str) -> String {
    let input = input.strip_prefix('\u{feff}').unwrap_or(input);
    strip_trailing_commas(&strip_comments(input))
}

fn strip_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            match ch {
                '\\' => out.extend(chars.next()),
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match (ch, chars.peek()) {
            ('"', _) => {
                in_string = true;
                out.push(ch);
            }
            ('/', Some('/')) => while chars.next_if(|next| *next != '\n').is_some() {},
            ('/', Some('*')) => {
                chars.next();
                let mut previous = ' ';
                for next in chars.by_ref() {
                    if previous == '*' && next == '/' {
                        break;
                    }
                    previous = next;
                }
                out.push(' ');
            }
            _ => out.push(ch),
        }
    }
    out
}

fn strip_trailing_commas(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut in_string = false;
    let mut index = 0;
    while index < chars.len() {
        let ch = chars[index];
        index += 1;
        if in_string {
            out.push(ch);
            match ch {
                '\\' => {
                    out.extend(chars.get(index));
                    index += 1;
                }
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        let closes_next = ch == ','
            && chars[index..]
                .iter()
                .find(|next| !next.is_whitespace())
                .is_some_and(|next| matches!(next, '}' | ']'));
        if closes_next {
            continue;
        }
        in_string = ch == '"';
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_configs(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::Builder::new()
            .prefix("flare-tsconfig-")
            .tempdir()
            .unwrap();
        for (path, content) in files {
            let full = dir.path().join(path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, content).unwrap();
        }
        dir
    }

    fn load(dir: &tempfile::TempDir, files: &[&str]) -> (AliasScopes, Vec<String>) {
        let files: Vec<String> = files.iter().map(ToString::to_string).collect();
        AliasScopes::load(dir.path(), &files)
    }

    #[test]
    fn recognises_config_file_names() {
        for name in [
            "tsconfig.json",
            "a/jsconfig.json",
            "tsconfig.app.json",
            "x/tsconfig.base.json",
        ] {
            assert!(is_config_file(name), "{name}");
        }
        for name in [
            "tsconfig.ts",
            "package.json",
            "mytsconfig.json",
            "tsconfigx.json",
        ] {
            assert!(!is_config_file(name), "{name}");
        }
    }

    #[test]
    fn strips_comments_and_trailing_commas_but_not_inside_strings() {
        let input = "\u{feff}{\n  // line\n  \"a\": \"http://x/*not*/\", /* block */\n  \"b\": [1, 2,],\n}\n";
        let value: Value = serde_json::from_str(&strip_jsonc(input)).unwrap();
        assert_eq!(value["a"], "http://x/*not*/");
        assert_eq!(value["b"], serde_json::json!([1, 2]));
    }

    #[test]
    fn keeps_escaped_quotes_inside_strings() {
        let value: Value = serde_json::from_str(&strip_jsonc(r#"{"a": "q\"//x", }"#)).unwrap();
        assert_eq!(value["a"], "q\"//x");
    }

    #[test]
    fn resolves_wildcard_paths_relative_to_the_config() {
        let dir = write_configs(&[(
            "tsconfig.json",
            r#"{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }"#,
        )]);
        let (scopes, warnings) = load(&dir, &["tsconfig.json"]);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(
            scopes.candidates("src/a/b.ts", "@/shared/x"),
            ["src/shared/x"]
        );
        assert!(scopes.candidates("src/a/b.ts", "other").is_empty());
    }

    #[test]
    fn prefers_the_longest_matching_pattern_and_supports_exact_patterns() {
        let dir = write_configs(&[(
            "tsconfig.json",
            r#"{ "compilerOptions": { "baseUrl": ".", "paths": {
                "@/*": ["src/*"], "@/ui/*": ["lib/ui/*"], "app": ["src/app/index.ts"] } } }"#,
        )]);
        let (scopes, _) = load(&dir, &["tsconfig.json"]);
        assert_eq!(scopes.candidates("a.ts", "@/ui/Button")[0], "lib/ui/Button");
        assert_eq!(scopes.candidates("a.ts", "@/other")[0], "src/other");
        assert_eq!(scopes.candidates("a.ts", "app")[0], "src/app/index.ts");
    }

    #[test]
    fn base_url_resolves_bare_specifiers() {
        let dir = write_configs(&[(
            "web/tsconfig.json",
            r#"{ "compilerOptions": { "baseUrl": "src" } }"#,
        )]);
        let (scopes, _) = load(&dir, &["web/tsconfig.json"]);
        assert_eq!(
            scopes.candidates("web/src/a.ts", "components/Button"),
            ["web/src/components/Button"]
        );
        assert!(scopes
            .candidates("server/a.ts", "components/Button")
            .is_empty());
    }

    #[test]
    fn nearest_config_wins_and_ancestors_are_still_consulted() {
        let dir = write_configs(&[
            (
                "tsconfig.json",
                r#"{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }"#,
            ),
            (
                "pkg/tsconfig.json",
                r#"{ "compilerOptions": { "paths": { "@/*": ["./lib/*"] } } }"#,
            ),
        ]);
        let (scopes, _) = load(&dir, &["tsconfig.json", "pkg/tsconfig.json"]);
        assert_eq!(scopes.candidates("pkg/a.ts", "@/x"), ["pkg/lib/x", "src/x"]);
        assert_eq!(scopes.candidates("other/a.ts", "@/x"), ["src/x"]);
    }

    #[test]
    fn follows_relative_extends_and_lets_children_override() {
        let dir = write_configs(&[
            (
                "tsconfig.base.json",
                r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }"#,
            ),
            (
                "app/tsconfig.json",
                r#"{ "extends": "../tsconfig.base", "compilerOptions": { "paths": { "~/*": ["app/*"] } } }"#,
            ),
        ]);
        let (scopes, warnings) = load(&dir, &["app/tsconfig.json"]);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(scopes.candidates("app/a.ts", "~/x")[0], "app/x");
        assert!(scopes
            .candidates("app/a.ts", "@/x")
            .iter()
            .all(|c| c != "src/x"));
    }

    #[test]
    fn reports_invalid_and_unreadable_configs_as_warnings() {
        let dir = write_configs(&[
            ("tsconfig.json", "{ not json"),
            ("b/tsconfig.json", r#"{"extends":"./missing.json"}"#),
        ]);
        let (scopes, warnings) = load(
            &dir,
            &["tsconfig.json", "b/tsconfig.json", "gone/tsconfig.json"],
        );
        assert!(scopes.candidates("a.ts", "@/x").is_empty());
        assert_eq!(warnings.len(), 3, "{warnings:?}");
        assert!(warnings.iter().any(|w| w.contains("invalid JSON")));
        assert!(warnings
            .iter()
            .any(|w| w.contains("gone/tsconfig.json: cannot read")));
    }

    #[test]
    fn rejects_patterns_with_two_wildcards() {
        let dir = write_configs(&[(
            "tsconfig.json",
            r#"{ "compilerOptions": { "paths": { "@/*/*": ["x/*"] } } }"#,
        )]);
        let (_, warnings) = load(&dir, &["tsconfig.json"]);
        assert_eq!(warnings.len(), 1);
    }
}
