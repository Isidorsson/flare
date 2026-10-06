use crate::graph::error::GraphError;

use super::Fixture;

fn layered_fixture() -> Fixture {
    Fixture::new(&[
        ("app.ts", "import './feature';\nimport './other';"),
        ("feature.ts", "import './shared';"),
        ("other.ts", "import './leaf';"),
        ("shared.ts", "import './leaf';"),
        ("leaf.ts", "export const leaf = 1;"),
        ("island.ts", ""),
    ])
}

fn depths(radius: &crate::graph::model::BlastRadius) -> Vec<(&str, u32)> {
    radius
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node.depth))
        .collect()
}

#[test]
fn reports_every_transitive_dependent_with_its_depth() {
    let indexer = layered_fixture().index();
    let radius = indexer.blast_radius("leaf.ts").unwrap();
    assert_eq!(radius.origin, "leaf.ts");
    assert_eq!(
        depths(&radius),
        [
            ("other.ts", 1),
            ("shared.ts", 1),
            ("app.ts", 2),
            ("feature.ts", 2)
        ]
    );
}

#[test]
fn a_file_nobody_imports_has_an_empty_radius() {
    let indexer = layered_fixture().index();
    assert!(indexer.blast_radius("app.ts").unwrap().nodes.is_empty());
    assert!(indexer.blast_radius("island.ts").unwrap().nodes.is_empty());
}

#[test]
fn accepts_absolute_paths_and_normalises_the_origin() {
    let fixture = layered_fixture();
    let indexer = fixture.index();
    let radius = indexer
        .blast_radius(&fixture.absolute("shared.ts"))
        .unwrap();
    assert_eq!(radius.origin, "shared.ts");
    assert_eq!(depths(&radius), [("feature.ts", 1), ("app.ts", 2)]);
}

#[test]
fn unknown_files_are_an_error_not_an_empty_result() {
    let indexer = layered_fixture().index();
    assert_eq!(
        indexer.blast_radius("missing.ts").unwrap_err(),
        GraphError::UnknownFile("missing.ts".into())
    );
}

#[test]
fn reflects_incremental_updates() {
    let fixture = layered_fixture();
    let mut indexer = fixture.index();
    fixture.write("island.ts", "import './leaf';");
    indexer.update_file("island.ts").unwrap();
    let radius = indexer.blast_radius("leaf.ts").unwrap();
    assert!(radius
        .nodes
        .iter()
        .any(|node| node.id == "island.ts" && node.depth == 1));
}

#[test]
fn works_across_languages_independently() {
    let fixture = Fixture::new(&[
        ("src/lib.rs", "mod a;\nmod b;"),
        ("src/a.rs", "use crate::b::X;"),
        ("src/b.rs", ""),
        ("tool.py", "import helper"),
        ("helper.py", ""),
    ]);
    let indexer = fixture.index();
    let rust = indexer.blast_radius("src/b.rs").unwrap();
    assert_eq!(depths(&rust), [("src/a.rs", 1), ("src/lib.rs", 1)]);
    let python = indexer.blast_radius("helper.py").unwrap();
    assert_eq!(depths(&python), [("tool.py", 1)]);
}
