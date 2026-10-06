use super::{edges, imports_of, pair, Fixture};

fn crate_fixture() -> Fixture {
    Fixture::new(&[
        ("Cargo.toml", "[package]\nname = \"demo\"\n"),
        (
            "src/lib.rs",
            "mod graph;\nmod util;\npub use crate::util::helper;\nuse serde::Serialize;\nuse std::collections::HashMap;\n",
        ),
        (
            "src/graph/mod.rs",
            "mod model;\nmod index;\npub use self::model::Node;\nuse crate::util;\n",
        ),
        (
            "src/graph/model.rs",
            "use super::index::Index;\nuse crate::util::{helper, other::Thing};\n",
        ),
        (
            "src/graph/index.rs",
            "mod child;\nuse super::model::{Node, Edge};\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n}\n",
        ),
        ("src/graph/index/child.rs", "use super::super::util;\n"),
        ("src/util.rs", "pub fn helper() {}\nmod other;\n"),
        ("src/util/other.rs", "pub struct Thing;\n"),
    ])
}

#[test]
fn mod_declarations_link_parent_to_child_files() {
    let indexer = crate_fixture().index();
    assert_eq!(
        imports_of(&indexer, "src/lib.rs"),
        ["src/graph/mod.rs", "src/util.rs"]
    );
    assert_eq!(imports_of(&indexer, "src/util.rs"), ["src/util/other.rs"]);
}

#[test]
fn use_paths_resolve_through_crate_self_and_super() {
    let indexer = crate_fixture().index();
    assert_eq!(
        imports_of(&indexer, "src/graph/mod.rs"),
        ["src/graph/index.rs", "src/graph/model.rs", "src/util.rs"]
    );
    assert_eq!(
        imports_of(&indexer, "src/graph/model.rs"),
        ["src/graph/index.rs", "src/util.rs", "src/util/other.rs"]
    );
}

#[test]
fn external_crates_std_and_inline_test_modules_create_no_edges() {
    let indexer = crate_fixture().index();
    assert_eq!(
        imports_of(&indexer, "src/graph/index.rs"),
        ["src/graph/index/child.rs", "src/graph/model.rs"]
    );
    assert!(!edges(&indexer)
        .iter()
        .any(|(_, target)| target.contains("serde")));
}

#[test]
fn nested_module_files_reach_ancestors_with_repeated_super() {
    let indexer = crate_fixture().index();
    assert_eq!(
        imports_of(&indexer, "src/graph/index/child.rs"),
        ["src/graph/mod.rs"]
    );
}

#[test]
fn pub_use_reexports_resolve_like_plain_use() {
    let indexer = crate_fixture().index();
    assert!(edges(&indexer).contains(&pair("src/lib.rs", "src/util.rs")));
}

#[test]
fn separate_crates_in_one_workspace_stay_separate() {
    let fixture = Fixture::new(&[
        ("a/src/lib.rs", "mod x;\nuse crate::x::Thing;\n"),
        ("a/src/x.rs", ""),
        ("b/src/lib.rs", "mod x;\nuse crate::x::Thing;\n"),
        ("b/src/x.rs", ""),
    ]);
    assert_eq!(
        edges(&fixture.index()),
        vec![
            pair("a/src/lib.rs", "a/src/x.rs"),
            pair("b/src/lib.rs", "b/src/x.rs")
        ]
    );
}

#[test]
fn binary_crates_resolve_modules_next_to_main() {
    let fixture = Fixture::new(&[
        ("src/main.rs", "mod cli;\nuse crate::cli::run;\n"),
        ("src/cli.rs", "use crate::config::Config;\n"),
        ("src/config.rs", ""),
    ]);
    let indexer = fixture.index();
    assert_eq!(imports_of(&indexer, "src/main.rs"), ["src/cli.rs"]);
    assert_eq!(imports_of(&indexer, "src/cli.rs"), ["src/config.rs"]);
}

#[test]
fn files_outside_any_crate_do_not_resolve_use_paths() {
    let fixture = Fixture::new(&[
        ("scripts/tool.rs", "use crate::missing::X;\nmod helper;\n"),
        ("scripts/tool/helper.rs", ""),
    ]);
    let indexer = fixture.index();
    assert_eq!(
        imports_of(&indexer, "scripts/tool.rs"),
        ["scripts/tool/helper.rs"]
    );
}
