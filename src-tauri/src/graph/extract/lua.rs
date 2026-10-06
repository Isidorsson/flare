use tree_sitter::Node;

use super::{node_text, walk_tree, RawImport, ScriptStep};

const REQUIRE: &str = "require";
const SCRIPT_ROOT: &str = "script";
const PARENT_PROPERTY: &str = "Parent";
const CHILD_LOOKUPS: [&str; 2] = ["WaitForChild", "FindFirstChild"];

pub(super) fn extract(root: Node<'_>, source: &[u8]) -> Vec<RawImport> {
    let mut imports = Vec::new();
    walk_tree(
        root,
        |_, _| None,
        source,
        |node, _| imports.extend(require_of(node, source)),
    );
    imports
}

fn require_of(call: Node<'_>, source: &[u8]) -> Option<RawImport> {
    if call.kind() != "function_call" {
        return None;
    }
    let callee = call.child_by_field_name("name")?;
    if callee.kind() != "identifier" || node_text(callee, source) != REQUIRE {
        return None;
    }
    let argument = call.child_by_field_name("arguments")?.named_child(0)?;
    if let Some(name) = string_content(argument, source) {
        return Some(RawImport::LuaModule { name });
    }
    let steps = script_steps(argument, source)?;
    (!steps.is_empty()).then_some(RawImport::RobloxPath { steps })
}

fn string_content(node: Node<'_>, source: &[u8]) -> Option<String> {
    if node.kind() != "string" {
        return None;
    }
    let content = node.child_by_field_name("content")?;
    Some(node_text(content, source).to_string())
}

fn script_steps(node: Node<'_>, source: &[u8]) -> Option<Vec<ScriptStep>> {
    match node.kind() {
        "identifier" => (node_text(node, source) == SCRIPT_ROOT).then(Vec::new),
        "parenthesized_expression" | "cast_expression" => {
            script_steps(node.named_child(0)?, source)
        }
        "dot_index_expression" => {
            let mut steps = script_steps(node.child_by_field_name("table")?, source)?;
            let field = node_text(node.child_by_field_name("field")?, source);
            steps.push(property_step(field));
            Some(steps)
        }
        "bracket_index_expression" => {
            let mut steps = script_steps(node.child_by_field_name("table")?, source)?;
            let name = string_content(node.child_by_field_name("field")?, source)?;
            steps.push(ScriptStep::Child(name));
            Some(steps)
        }
        "function_call" => child_lookup_steps(node, source),
        _ => None,
    }
}

fn property_step(field: &str) -> ScriptStep {
    if field == PARENT_PROPERTY {
        ScriptStep::Parent
    } else {
        ScriptStep::Child(field.to_string())
    }
}

fn child_lookup_steps(call: Node<'_>, source: &[u8]) -> Option<Vec<ScriptStep>> {
    let callee = call.child_by_field_name("name")?;
    if callee.kind() != "method_index_expression" {
        return None;
    }
    let method = node_text(callee.child_by_field_name("method")?, source);
    if !CHILD_LOOKUPS.contains(&method) {
        return None;
    }
    let mut steps = script_steps(callee.child_by_field_name("table")?, source)?;
    let first_argument = call.child_by_field_name("arguments")?.named_child(0)?;
    steps.push(ScriptStep::Child(string_content(first_argument, source)?));
    Some(steps)
}

#[cfg(test)]
mod tests {
    use crate::graph::extract::Extractor;
    use crate::graph::lang::SourceKind;

    use super::*;

    fn requires(kind: SourceKind, source: &str) -> Vec<RawImport> {
        Extractor::new()
            .extract(kind, "test", source.as_bytes())
            .unwrap()
            .imports
    }

    fn module(name: &str) -> RawImport {
        RawImport::LuaModule { name: name.into() }
    }

    fn steps(parts: &[&str]) -> RawImport {
        RawImport::RobloxPath {
            steps: parts
                .iter()
                .map(|part| match *part {
                    "^" => ScriptStep::Parent,
                    name => ScriptStep::Child(name.to_string()),
                })
                .collect(),
        }
    }

    #[test]
    fn finds_every_call_style_of_require() {
        let source = "local a = require(\"a.b\")\nlocal b = require 'c.d'\nrequire[[e.f]]\nlocal n = require(name)\nprint(\"x.y\")\n";
        let expected = vec![module("a.b"), module("c.d"), module("e.f")];
        assert_eq!(requires(SourceKind::Lua, source), expected);
        assert_eq!(requires(SourceKind::Luau, source), expected);
    }

    #[test]
    fn finds_requires_nested_in_functions_and_tables() {
        let source =
            "local function load()\n  return { m = require('deep.mod') }\nend\nif x then require('cond') end\n";
        assert_eq!(
            requires(SourceKind::Lua, source),
            vec![module("deep.mod"), module("cond")]
        );
    }

    #[test]
    fn follows_roblox_instance_paths_from_script() {
        let source = "local a = require(script.Parent.X)\nlocal b = require(script.Parent.Parent.Shared.Util)\nlocal c = require(script.Child)\n";
        assert_eq!(
            requires(SourceKind::Luau, source),
            vec![
                steps(&["^", "X"]),
                steps(&["^", "^", "Shared", "Util"]),
                steps(&["Child"]),
            ]
        );
    }

    #[test]
    fn roblox_instance_paths_also_parse_in_plain_lua_files() {
        let source = "local a = require(script.Parent.X)
local b = require(script.Parent:WaitForChild(\"Y\"))
";
        assert_eq!(
            requires(SourceKind::Lua, source),
            vec![steps(&["^", "X"]), steps(&["^", "Y"])]
        );
    }

    #[test]
    fn follows_wait_for_child_and_bracket_lookups() {
        let source = "local a = require(script.Parent:WaitForChild(\"Y\"))\nlocal b = require(script:FindFirstChild(\"Z\"))\nlocal c = require(script.Parent[\"My Module\"])\nlocal d = require(script.Parent.X :: any)\n";
        assert_eq!(
            requires(SourceKind::Luau, source),
            vec![
                steps(&["^", "Y"]),
                steps(&["Z"]),
                steps(&["^", "My Module"]),
                steps(&["^", "X"]),
            ]
        );
    }

    #[test]
    fn instance_paths_that_do_not_start_at_script_are_not_followed() {
        let source = "local a = require(game:GetService(\"ReplicatedStorage\").Shared)\nlocal b = require(Packages.Fusion)\nlocal c = require(script)\n";
        assert!(requires(SourceKind::Luau, source).is_empty());
    }

    #[test]
    fn luau_string_requires_keep_their_relative_prefix() {
        let source = "local a = require(\"./sibling\")\nlocal b = require(\"../up/mod\")\n";
        assert_eq!(
            requires(SourceKind::Luau, source),
            vec![module("./sibling"), module("../up/mod")]
        );
    }

    #[test]
    fn typed_luau_code_still_yields_its_requires() {
        let source = "type T = { x: number }\nlocal m: T = require(\"m\")\nlocal function f(a: number): string return \"\" end\n";
        assert_eq!(requires(SourceKind::Luau, source), vec![module("m")]);
    }
}
