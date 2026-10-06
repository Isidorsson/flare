use crate::graph::error::GraphError;
use crate::graph::indexer::Indexer;

use super::{edges, node_ids, Fixture};

#[test]
fn respects_gitignore_hidden_directories_and_vendored_code() {
    let fixture = Fixture::new(&[
        (".gitignore", "dist/\ncoverage\n"),
        ("src/a.ts", "import './b';"),
        ("src/b.ts", ""),
        ("dist/a.js", ""),
        ("coverage/lcov.js", ""),
        ("node_modules/pkg/index.js", ""),
        (".vscode/x.ts", ""),
        ("venv/lib/site-packages/dep.py", ""),
        ("pkg/__pycache__/x.py", ""),
    ]);
    assert_eq!(node_ids(&fixture.index()), ["src/a.ts", "src/b.ts"]);
}

#[test]
fn indexes_all_four_language_families_into_one_graph() {
    let fixture = Fixture::new(&[
        ("web/a.tsx", "import './b';"),
        ("web/b.ts", ""),
        ("web/c.js", ""),
        ("core/src/lib.rs", "mod m;"),
        ("core/src/m.rs", ""),
        ("tools/x.py", ""),
        ("notes.md", "# ignored"),
    ]);
    let snapshot = fixture.index().snapshot();
    assert_eq!(snapshot.nodes.len(), 6);
    assert_eq!(snapshot.edges.len(), 2);
}

#[test]
fn snapshot_root_is_a_forward_slash_path_without_verbatim_prefix() {
    let fixture = Fixture::new(&[("a.ts", "")]);
    let root = fixture.index().snapshot().root;
    assert!(!root.contains('\\'), "{root}");
    assert!(!root.starts_with("//?/"), "{root}");
}

#[test]
fn output_order_is_deterministic() {
    let files = [
        ("b.ts", "import './a';"),
        ("a.ts", ""),
        ("c.ts", "import './a';\nimport './b';"),
    ];
    let first = Fixture::new(&files).index().snapshot();
    let second = Fixture::new(&files).index().snapshot();
    assert_eq!(first.nodes, second.nodes);
    assert_eq!(first.edges, second.edges);
    assert_eq!(
        first
            .nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<Vec<_>>(),
        ["a.ts", "b.ts", "c.ts"]
    );
}

#[test]
fn an_empty_workspace_yields_an_empty_graph() {
    let fixture = Fixture::new(&[("readme.md", "")]);
    let snapshot = fixture.index().snapshot();
    assert!(snapshot.nodes.is_empty());
    assert!(snapshot.edges.is_empty());
    assert!(snapshot.warnings.is_empty());
}

#[test]
fn a_missing_root_is_an_error() {
    let fixture = Fixture::new(&[]);
    let result = Indexer::build(&fixture.path().join("does-not-exist"));
    assert!(matches!(result, Err(GraphError::Io { .. })));
}

#[test]
fn a_file_is_not_a_valid_root() {
    let fixture = Fixture::new(&[("a.ts", "")]);
    let result = Indexer::build(&fixture.path().join("a.ts"));
    assert!(matches!(result, Err(GraphError::InvalidRoot(_))));
}

#[test]
fn invalid_tsconfig_is_reported_as_a_warning_without_failing_the_index() {
    let fixture = Fixture::new(&[
        ("tsconfig.json", "{ nope"),
        ("a.ts", "import './b';"),
        ("b.ts", ""),
    ]);
    let indexer = fixture.index();
    assert_eq!(edges(&indexer).len(), 1);
    let warnings = indexer.snapshot().warnings;
    assert!(
        warnings
            .iter()
            .any(|warning| warning.starts_with("tsconfig.json")),
        "{warnings:?}"
    );
}

#[test]
fn warnings_are_capped_with_a_summary_line() {
    let files: Vec<(String, String)> = (0..60)
        .map(|index| (format!("pkg{index}/tsconfig.json"), "{ nope".to_string()))
        .collect();
    let borrowed: Vec<(&str, &str)> = files
        .iter()
        .map(|(path, body)| (path.as_str(), body.as_str()))
        .collect();
    let warnings = Fixture::new(&borrowed).index().snapshot().warnings;
    assert_eq!(warnings.len(), 51);
    assert_eq!(
        warnings.last().map(String::as_str),
        Some("and 10 more warnings")
    );
}
