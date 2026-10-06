use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, node_ids, pair, Fixture};

fn lua_fixture() -> Fixture {
    Fixture::new(&[
        (
            "main.lua",
            "local s = require('util.str')\nlocal c = require \"core\"\nlocal sock = require('socket')\n",
        ),
        ("util/str.lua", "local h = require('util.helper')\n"),
        ("util/helper.lua", ""),
        ("lua/core/init.lua", "return {}\n"),
    ])
}

fn roblox_fixture() -> Fixture {
    Fixture::new(&[
        (
            "src/server/Main.server.luau",
            "local Util = require(script.Parent.Shared.Util)\nlocal Cfg = require(script.Parent:WaitForChild(\"Config\"))\nlocal Rs = require(game.ReplicatedStorage.Thing)\nlocal Rel = require(\"./Local\")\n",
        ),
        ("src/server/Shared/Util.luau", ""),
        ("src/server/Config.luau", ""),
        ("src/server/Local.luau", ""),
    ])
}

#[test]
fn dotted_requires_resolve_through_package_path_roots() {
    let indexer = lua_fixture().index();
    assert_eq!(
        edges(&indexer),
        vec![
            pair("main.lua", "lua/core/init.lua"),
            pair("main.lua", "util/str.lua"),
            pair("util/str.lua", "util/helper.lua"),
        ]
    );
}

#[test]
fn roblox_instance_paths_and_luau_string_requires_resolve() {
    let indexer = roblox_fixture().index();
    assert_eq!(
        imports_of(&indexer, "src/server/Main.server.luau"),
        [
            "src/server/Config.luau",
            "src/server/Local.luau",
            "src/server/Shared/Util.luau",
        ]
    );
}

#[test]
fn nodes_carry_the_lua_and_luau_labels() {
    let fixture = Fixture::new(&[("a.lua", ""), ("b.luau", "")]);
    let indexer = fixture.index();
    assert_eq!(language_of(&indexer, "a.lua"), Some(Language::Lua));
    assert_eq!(language_of(&indexer, "b.luau"), Some(Language::Luau));
}

#[test]
fn unresolved_requires_create_no_edges_but_keep_the_node() {
    let fixture = Fixture::new(&[(
        "a.lua",
        "require('missing.mod')\nrequire(dynamic .. 'x')\nrequire('socket.http')\n",
    )]);
    let indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    assert_eq!(node_ids(&indexer), ["a.lua"]);
}

#[test]
fn adding_the_required_module_resolves_a_dangling_require() {
    let fixture = Fixture::new(&[("a.lua", "require('later')\n")]);
    let mut indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    fixture.write("later.lua", "");
    assert_eq!(indexer.update_file("later.lua").unwrap(), Change::Added);
    assert_eq!(edges(&indexer), vec![pair("a.lua", "later.lua")]);
}

#[test]
fn editing_requires_updates_edges() {
    let fixture = Fixture::new(&[("a.lua", "require('b')\n"), ("b.lua", ""), ("c.lua", "")]);
    let mut indexer = fixture.index();
    fixture.write("a.lua", "require('c')\n");
    assert_eq!(indexer.update_file("a.lua").unwrap(), Change::Updated);
    assert_eq!(edges(&indexer), vec![pair("a.lua", "c.lua")]);
}

#[test]
fn roblox_requires_follow_files_added_and_removed_later() {
    let fixture = Fixture::new(&[("src/Main.luau", "local X = require(script.Parent.X)\n")]);
    let mut indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    fixture.write("src/X.luau", "");
    assert_eq!(indexer.update_file("src/X.luau").unwrap(), Change::Added);
    assert_eq!(edges(&indexer), vec![pair("src/Main.luau", "src/X.luau")]);
    fixture.delete("src/X.luau");
    assert_eq!(indexer.remove_file("src/X.luau").unwrap(), Change::Removed);
    assert!(edges(&indexer).is_empty());
}

#[test]
fn a_sibling_file_wins_over_an_init_module() {
    let fixture = Fixture::new(&[("a.lua", "require('m')\n"), ("m/init.lua", "")]);
    let mut indexer = fixture.index();
    assert_eq!(imports_of(&indexer, "a.lua"), ["m/init.lua"]);
    fixture.write("m.lua", "");
    indexer.update_file("m.lua").unwrap();
    assert_eq!(imports_of(&indexer, "a.lua"), ["m.lua"]);
}

#[test]
fn every_spelling_of_the_same_require_yields_one_edge() {
    let source = "local a = require(\"util.str\")\nlocal b = require \"util.str\"\nlocal c = require 'util.str'\nlocal d = require[[util.str]]\nlocal e = require(\"util/str\")\nlocal f = require('util.str')\n";
    let fixture = Fixture::new(&[("main.lua", source), ("util/str.lua", "")]);
    let mut indexer = fixture.index();
    assert_eq!(edges(&indexer), vec![pair("main.lua", "util/str.lua")]);
    fixture.write("main.lua", &format!("{source}require('util.str')\n"));
    indexer.update_file("main.lua").unwrap();
    assert_eq!(edges(&indexer), vec![pair("main.lua", "util/str.lua")]);
}

#[test]
fn edges_keep_their_direction_and_only_mutual_requires_go_both_ways() {
    let fixture = Fixture::new(&[
        (
            "AIO.lua",
            "local AIO = AIO or require(\"AIO\")\nlocal q = require(\"queue\")\n",
        ),
        ("queue.lua", ""),
        (
            "Server.lua",
            "local AIO = require(\"AIO\")\nlocal p = require(\"Peer\")\n",
        ),
        ("Peer.lua", "local s = require(\"Server\")\n"),
    ]);
    let indexer = fixture.index();
    assert_eq!(
        edges(&indexer),
        vec![
            pair("AIO.lua", "queue.lua"),
            pair("Peer.lua", "Server.lua"),
            pair("Server.lua", "AIO.lua"),
            pair("Server.lua", "Peer.lua"),
        ]
    );
}
