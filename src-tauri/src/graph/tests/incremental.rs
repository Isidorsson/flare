use crate::graph::error::GraphError;
use crate::graph::indexer::MAX_SOURCE_BYTES;
use crate::graph::model::Change;

use super::{edges, imports_of, node_ids, pair, Fixture};

fn two_files() -> Fixture {
    Fixture::new(&[("a.ts", "import './b';"), ("b.ts", ""), ("c.ts", "")])
}

#[test]
fn editing_imports_updates_edges_and_reports_updated() {
    let fixture = two_files();
    let mut indexer = fixture.index();
    fixture.write("a.ts", "import './c';");
    assert_eq!(indexer.update_file("a.ts").unwrap(), Change::Updated);
    assert_eq!(imports_of(&indexer, "a.ts"), ["c.ts"]);
}

#[test]
fn removing_the_last_import_removes_the_edge_entry() {
    let fixture = two_files();
    let mut indexer = fixture.index();
    fixture.write("a.ts", "export const x = 1;");
    assert_eq!(indexer.update_file("a.ts").unwrap(), Change::Updated);
    assert!(edges(&indexer).is_empty());
}

#[test]
fn rewriting_a_file_without_touching_imports_is_unchanged() {
    let fixture = two_files();
    let mut indexer = fixture.index();
    fixture.write("a.ts", "import './b';\nexport const changed = true;");
    assert_eq!(indexer.update_file("a.ts").unwrap(), Change::Unchanged);
    assert_eq!(edges(&indexer), vec![pair("a.ts", "b.ts")]);
}

#[test]
fn adding_a_file_resolves_previously_dangling_imports() {
    let fixture = Fixture::new(&[("a.ts", "import './later';")]);
    let mut indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    fixture.write("later.ts", "");
    let change = indexer.update_file(&fixture.absolute("later.ts")).unwrap();
    assert_eq!(change, Change::Added);
    assert_eq!(edges(&indexer), vec![pair("a.ts", "later.ts")]);
    assert_eq!(node_ids(&indexer), ["a.ts", "later.ts"]);
}

#[test]
fn adding_a_file_that_shadows_an_import_target_redirects_the_edge() {
    let fixture = Fixture::new(&[("a.ts", "import './x';"), ("x/index.ts", "")]);
    let mut indexer = fixture.index();
    assert_eq!(imports_of(&indexer, "a.ts"), ["x/index.ts"]);
    fixture.write("x.ts", "");
    assert_eq!(indexer.update_file("x.ts").unwrap(), Change::Added);
    assert_eq!(imports_of(&indexer, "a.ts"), ["x.ts"]);
}

#[test]
fn removing_a_file_drops_its_node_and_edges() {
    let fixture = two_files();
    let mut indexer = fixture.index();
    fixture.delete("b.ts");
    assert_eq!(indexer.remove_file("b.ts").unwrap(), Change::Removed);
    assert_eq!(node_ids(&indexer), ["a.ts", "c.ts"]);
    assert!(edges(&indexer).is_empty());
}

#[test]
fn removing_a_file_falls_back_to_the_next_resolution_candidate() {
    let fixture = Fixture::new(&[
        ("a.ts", "import './foo';"),
        ("foo.ts", ""),
        ("foo/index.ts", ""),
    ]);
    let mut indexer = fixture.index();
    assert_eq!(imports_of(&indexer, "a.ts"), ["foo.ts"]);
    fixture.delete("foo.ts");
    assert_eq!(indexer.remove_file("foo.ts").unwrap(), Change::Removed);
    assert_eq!(imports_of(&indexer, "a.ts"), ["foo/index.ts"]);
}

#[test]
fn removing_a_directory_removes_every_file_beneath_it() {
    let fixture = Fixture::new(&[
        ("a.ts", "import './lib/x';"),
        ("lib/x.ts", ""),
        ("lib/deep/y.ts", ""),
        ("library.ts", ""),
    ]);
    let mut indexer = fixture.index();
    fixture.delete("lib");
    assert_eq!(indexer.remove_file("lib").unwrap(), Change::Removed);
    assert_eq!(node_ids(&indexer), ["a.ts", "library.ts"]);
    assert!(edges(&indexer).is_empty());
}

#[test]
fn updating_a_file_deleted_on_disk_removes_it() {
    let fixture = two_files();
    let mut indexer = fixture.index();
    fixture.delete("b.ts");
    assert_eq!(indexer.update_file("b.ts").unwrap(), Change::Removed);
    assert_eq!(node_ids(&indexer), ["a.ts", "c.ts"]);
}

#[test]
fn removing_an_unknown_path_changes_nothing() {
    let fixture = two_files();
    let mut indexer = fixture.index();
    assert_eq!(indexer.remove_file("nope.ts").unwrap(), Change::Unchanged);
    assert_eq!(node_ids(&indexer).len(), 3);
}

#[test]
fn absolute_backslash_and_relative_paths_address_the_same_file() {
    let fixture = two_files();
    let mut indexer = fixture.index();
    let absolute = fixture.absolute("a.ts");
    let backslashed = absolute.replace('/', "\\");
    for path in [
        absolute,
        backslashed,
        "./a.ts".to_string(),
        "a.ts".to_string(),
    ] {
        fixture.write("a.ts", &format!("import './b';\n// {path}"));
        assert_eq!(
            indexer.update_file(&path).unwrap(),
            Change::Unchanged,
            "{path}"
        );
    }
    assert_eq!(node_ids(&indexer).len(), 3);
}

#[test]
fn paths_outside_the_workspace_are_rejected() {
    let fixture = two_files();
    let other = Fixture::new(&[("x.ts", "")]);
    let mut indexer = fixture.index();
    let outside = other.absolute("x.ts");
    assert_eq!(
        indexer.update_file(&outside).unwrap_err(),
        GraphError::OutsideWorkspace(outside.clone())
    );
    assert_eq!(
        indexer.remove_file(&outside).unwrap_err(),
        GraphError::OutsideWorkspace(outside)
    );
    assert!(matches!(
        indexer.update_file("../escape.ts"),
        Err(GraphError::OutsideWorkspace(_))
    ));
}

#[test]
fn ignored_and_non_source_files_are_never_indexed() {
    let fixture = Fixture::new(&[(".gitignore", "dist/\n"), ("a.ts", "")]);
    let mut indexer = fixture.index();
    fixture.write("dist/gen.ts", "");
    fixture.write("README.md", "# docs");
    fixture.write("node_modules/p/index.js", "");
    fixture.write(".cache/x.ts", "");
    for path in [
        "dist/gen.ts",
        "README.md",
        "node_modules/p/index.js",
        ".cache/x.ts",
    ] {
        assert_eq!(
            indexer.update_file(path).unwrap(),
            Change::Unchanged,
            "{path}"
        );
    }
    assert_eq!(node_ids(&indexer), ["a.ts"]);
}

#[test]
fn editing_a_tsconfig_re_resolves_aliases() {
    let fixture = Fixture::new(&[
        (
            "tsconfig.json",
            r#"{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }"#,
        ),
        ("main.ts", "import '@/x';"),
        ("src/x.ts", ""),
        ("lib/x.ts", ""),
    ]);
    let mut indexer = fixture.index();
    assert_eq!(imports_of(&indexer, "main.ts"), ["src/x.ts"]);
    fixture.write(
        "tsconfig.json",
        r#"{ "compilerOptions": { "paths": { "@/*": ["./lib/*"] } } }"#,
    );
    assert_eq!(
        indexer.update_file("tsconfig.json").unwrap(),
        Change::Updated
    );
    assert_eq!(imports_of(&indexer, "main.ts"), ["lib/x.ts"]);
}

#[test]
fn creating_and_deleting_a_tsconfig_toggles_the_alias() {
    let fixture = Fixture::new(&[("main.ts", "import '@/x';"), ("src/x.ts", "")]);
    let mut indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    fixture.write(
        "tsconfig.json",
        r#"{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }"#,
    );
    assert_eq!(
        indexer.update_file("tsconfig.json").unwrap(),
        Change::Updated
    );
    assert_eq!(imports_of(&indexer, "main.ts"), ["src/x.ts"]);
    fixture.delete("tsconfig.json");
    indexer.remove_file("tsconfig.json").unwrap();
    assert!(edges(&indexer).is_empty());
}

#[test]
fn editing_a_package_manifest_re_resolves_workspace_imports() {
    let fixture = Fixture::new(&[
        (
            "lib/package.json",
            r#"{ "name": "@app/lib", "main": "src/old.ts" }"#,
        ),
        ("lib/src/old.ts", ""),
        ("lib/src/new.ts", ""),
        ("app.ts", "import '@app/lib';"),
    ]);
    let mut indexer = fixture.index();
    assert_eq!(imports_of(&indexer, "app.ts"), ["lib/src/old.ts"]);
    fixture.write(
        "lib/package.json",
        r#"{ "name": "@app/lib", "main": "src/new.ts" }"#,
    );
    assert_eq!(
        indexer.update_file("lib/package.json").unwrap(),
        Change::Updated
    );
    assert_eq!(imports_of(&indexer, "app.ts"), ["lib/src/new.ts"]);
    fixture.delete("lib/package.json");
    indexer.remove_file("lib/package.json").unwrap();
    assert!(edges(&indexer).is_empty());
}

#[test]
fn editing_a_gitignore_rebuilds_with_the_new_rules() {
    let fixture = Fixture::new(&[(".gitignore", ""), ("a.ts", ""), ("gen/b.ts", "")]);
    let mut indexer = fixture.index();
    assert_eq!(node_ids(&indexer), ["a.ts", "gen/b.ts"]);
    fixture.write(".gitignore", "gen/\n");
    assert_eq!(indexer.update_file(".gitignore").unwrap(), Change::Rebuilt);
    assert_eq!(node_ids(&indexer), ["a.ts"]);
    fixture.write(".gitignore", "");
    assert_eq!(indexer.update_file(".gitignore").unwrap(), Change::Rebuilt);
    assert_eq!(node_ids(&indexer), ["a.ts", "gen/b.ts"]);
}

#[test]
fn oversized_sources_are_skipped_at_build_and_rejected_on_update() {
    let fixture = Fixture::new(&[("a.ts", "")]);
    let big = "x".repeat(usize::try_from(MAX_SOURCE_BYTES).unwrap() + 1);
    fixture.write("big.ts", &big);
    let mut indexer = fixture.index();
    assert_eq!(node_ids(&indexer), ["a.ts"]);
    let warnings = indexer.snapshot().warnings;
    assert!(
        warnings.iter().any(|warning| warning.contains("big.ts")),
        "{warnings:?}"
    );
    assert!(matches!(
        indexer.update_file("big.ts"),
        Err(GraphError::Io { .. })
    ));
}

#[test]
fn half_typed_code_stays_in_the_graph_with_the_imports_that_still_parse() {
    let fixture = two_files();
    let mut indexer = fixture.index();
    fixture.write("a.ts", "import './c';\nconst x = {{{ \n");
    assert_eq!(indexer.update_file("a.ts").unwrap(), Change::Updated);
    assert_eq!(imports_of(&indexer, "a.ts"), ["c.ts"]);
    assert_eq!(node_ids(&indexer).len(), 3);
}
