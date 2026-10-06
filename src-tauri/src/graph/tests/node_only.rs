use crate::graph::model::{Change, Language};

use super::{edges, language_of, node_ids, Fixture};

#[test]
fn swift_files_are_nodes_without_edges() {
    let fixture = Fixture::new(&[
        (
            "Sources/App/main.swift",
            "import Foundation\nimport Lib\nprint(\"hi\")\n",
        ),
        ("Sources/Lib/Lib.swift", "public struct Lib {}\n"),
    ]);
    let indexer = fixture.index();
    assert_eq!(
        node_ids(&indexer),
        ["Sources/App/main.swift", "Sources/Lib/Lib.swift"]
    );
    assert!(edges(&indexer).is_empty());
    assert_eq!(
        language_of(&indexer, "Sources/App/main.swift"),
        Some(Language::Swift)
    );
}

#[test]
fn swift_files_join_and_leave_the_graph_incrementally() {
    let fixture = Fixture::new(&[("a.swift", "")]);
    let mut indexer = fixture.index();
    fixture.write("b.swift", "import Foundation\n");
    assert_eq!(indexer.update_file("b.swift").unwrap(), Change::Added);
    assert_eq!(node_ids(&indexer), ["a.swift", "b.swift"]);
    fixture.write("b.swift", "import UIKit\n");
    assert_eq!(indexer.update_file("b.swift").unwrap(), Change::Unchanged);
    fixture.delete("a.swift");
    assert_eq!(indexer.remove_file("a.swift").unwrap(), Change::Removed);
    assert_eq!(node_ids(&indexer), ["b.swift"]);
}

#[test]
fn every_new_language_appears_as_a_node_even_when_empty() {
    let files = [
        ("a.lua", Language::Lua),
        ("a.luau", Language::Luau),
        ("a.go", Language::Go),
        ("a.c", Language::C),
        ("a.cpp", Language::Cpp),
        ("a.cs", Language::CSharp),
        ("a.java", Language::Java),
        ("a.kt", Language::Kotlin),
        ("a.rb", Language::Ruby),
        ("a.php", Language::Php),
        ("a.swift", Language::Swift),
        ("a.dart", Language::Dart),
        ("a.zig", Language::Zig),
        ("a.sh", Language::Shell),
        ("a.css", Language::Css),
        ("a.scss", Language::Css),
        ("a.less", Language::Css),
        ("a.vue", Language::Vue),
        ("a.svelte", Language::Svelte),
    ];
    let fixture = Fixture::new(&files.map(|(path, _)| (path, "")));
    let indexer = fixture.index();
    for (path, language) in files {
        assert_eq!(language_of(&indexer, path), Some(language), "{path}");
    }
    assert!(indexer.snapshot().warnings.is_empty());
}

#[test]
fn files_with_syntax_errors_stay_in_the_graph_for_every_grammar() {
    let garbage = "}}} ((( ;;; ''' \"\"\" <<< >>>\n";
    let paths = [
        "a.lua", "a.luau", "a.go", "a.c", "a.cpp", "a.cs", "a.java", "a.kt", "a.rb", "a.php",
        "a.dart", "a.zig", "a.sh", "a.css", "a.vue", "a.svelte",
    ];
    let fixture = Fixture::new(&paths.map(|path| (path, garbage)));
    let indexer = fixture.index();
    assert_eq!(node_ids(&indexer).len(), paths.len());
    assert!(indexer.snapshot().warnings.is_empty());
}

#[test]
fn a_mixed_polyglot_workspace_builds_one_graph() {
    let fixture = Fixture::new(&[
        ("go.mod", "module example.com/poly\n"),
        ("main.go", "package main\nimport \"example.com/poly/pkg\"\n"),
        ("pkg/pkg.go", "package pkg\n"),
        ("native/a.c", "#include \"a.h\"\n"),
        ("native/a.h", ""),
        ("web/app.ts", "import './app.css';\n"),
        ("web/app.css", ""),
        ("tools/run.sh", "source ./lib.sh\n"),
        ("tools/lib.sh", ""),
    ]);
    let snapshot = fixture.index().snapshot();
    assert_eq!(snapshot.nodes.len(), 8);
    assert_eq!(snapshot.edges.len(), 4);
}
