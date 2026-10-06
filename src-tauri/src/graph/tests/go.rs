use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, node_ids, pair, Fixture};

fn module_fixture() -> Fixture {
    Fixture::new(&[
        ("go.mod", "module example.com/app\n\ngo 1.22\n"),
        (
            "main.go",
            "package main\n\nimport (\n\t\"fmt\"\n\t\"github.com/other/dep\"\n\t\"example.com/app/internal/store\"\n)\n",
        ),
        ("internal/store/store.go", "package store\n"),
        ("internal/store/memory.go", "package store\n"),
        ("internal/store/store_windows.go", "package store\n"),
        (
            "internal/store/store_test.go",
            "package store\n\nimport \"example.com/app/internal/util\"\n",
        ),
        ("internal/util/util.go", "package util\n"),
    ])
}

#[test]
fn an_import_links_every_non_test_file_of_the_package_directory() {
    let indexer = module_fixture().index();
    assert_eq!(
        imports_of(&indexer, "main.go"),
        [
            "internal/store/memory.go",
            "internal/store/store.go",
            "internal/store/store_windows.go",
        ]
    );
}

#[test]
fn test_files_import_packages_but_are_never_import_targets() {
    let indexer = module_fixture().index();
    assert_eq!(
        imports_of(&indexer, "internal/store/store_test.go"),
        ["internal/util/util.go"]
    );
    assert!(edges(&indexer)
        .iter()
        .all(|(_, target)| target != "internal/store/store_test.go"));
}

#[test]
fn standard_library_and_foreign_modules_create_no_edges() {
    let fixture = Fixture::new(&[
        ("go.mod", "module m\n"),
        (
            "a.go",
            "package a\nimport (\"fmt\"; \"golang.org/x/text\"; \"C\")\n",
        ),
    ]);
    let indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    assert_eq!(language_of(&indexer, "a.go"), Some(Language::Go));
}

#[test]
fn nested_modules_win_over_their_parent_module() {
    let fixture = Fixture::new(&[
        ("go.mod", "module example.com/app\n"),
        ("svc/go.mod", "module example.com/app/svc\n"),
        ("svc/api/api.go", "package api\n"),
        ("api/api.go", "package api\n"),
        (
            "main.go",
            "package main\nimport \"example.com/app/svc/api\"\nimport \"example.com/app/api\"\n",
        ),
    ]);
    assert_eq!(
        imports_of(&fixture.index(), "main.go"),
        ["api/api.go", "svc/api/api.go"]
    );
}

#[test]
fn local_replace_directives_point_at_workspace_directories() {
    let fixture = Fixture::new(&[
        (
            "app/go.mod",
            "module example.com/app\n\nreplace example.com/lib => ../lib\n",
        ),
        (
            "app/main.go",
            "package main\nimport \"example.com/lib/util\"\n",
        ),
        ("lib/util/util.go", "package util\n"),
    ]);
    assert_eq!(
        imports_of(&fixture.index(), "app/main.go"),
        ["lib/util/util.go"]
    );
}

#[test]
fn imports_without_a_go_mod_do_not_resolve() {
    let fixture = Fixture::new(&[
        ("main.go", "package main\nimport \"example.com/app/pkg\"\n"),
        ("pkg/pkg.go", "package pkg\n"),
    ]);
    assert!(edges(&fixture.index()).is_empty());
}

#[test]
fn adding_a_file_to_a_package_links_it_from_every_importer() {
    let fixture = module_fixture();
    let mut indexer = fixture.index();
    fixture.write("internal/store/disk.go", "package store\n");
    assert_eq!(
        indexer.update_file("internal/store/disk.go").unwrap(),
        Change::Added
    );
    assert!(imports_of(&indexer, "main.go").contains(&"internal/store/disk.go".to_string()));
}

#[test]
fn removing_a_package_file_drops_only_its_edge() {
    let fixture = module_fixture();
    let mut indexer = fixture.index();
    fixture.delete("internal/store/memory.go");
    assert_eq!(
        indexer.remove_file("internal/store/memory.go").unwrap(),
        Change::Removed
    );
    assert_eq!(
        imports_of(&indexer, "main.go"),
        ["internal/store/store.go", "internal/store/store_windows.go"]
    );
}

#[test]
fn editing_a_go_file_import_updates_its_edges() {
    let fixture = module_fixture();
    let mut indexer = fixture.index();
    fixture.write(
        "main.go",
        "package main\nimport \"example.com/app/internal/util\"\n",
    );
    assert_eq!(indexer.update_file("main.go").unwrap(), Change::Updated);
    assert_eq!(imports_of(&indexer, "main.go"), ["internal/util/util.go"]);
}

#[test]
fn editing_go_mod_re_resolves_import_paths() {
    let fixture = module_fixture();
    let mut indexer = fixture.index();
    assert!(!imports_of(&indexer, "main.go").is_empty());
    fixture.write("go.mod", "module example.com/renamed\n");
    assert_eq!(indexer.update_file("go.mod").unwrap(), Change::Updated);
    assert!(imports_of(&indexer, "main.go").is_empty());
    fixture.write("go.mod", "module example.com/app\n");
    assert_eq!(indexer.update_file("go.mod").unwrap(), Change::Updated);
    assert_eq!(imports_of(&indexer, "main.go").len(), 3);
}

#[test]
fn deleting_go_mod_removes_the_edges_and_keeps_the_nodes() {
    let fixture = module_fixture();
    let mut indexer = fixture.index();
    let nodes = node_ids(&indexer);
    fixture.delete("go.mod");
    indexer.remove_file("go.mod").unwrap();
    assert!(imports_of(&indexer, "main.go").is_empty());
    assert_eq!(node_ids(&indexer), nodes);
}

#[test]
fn vendored_dependencies_are_not_indexed() {
    let fixture = Fixture::new(&[
        ("go.mod", "module m\n"),
        ("main.go", "package main\n"),
        ("vendor/github.com/x/y/y.go", "package y\n"),
    ]);
    assert_eq!(node_ids(&fixture.index()), ["main.go"]);
}

#[test]
fn a_new_go_mod_in_a_subdirectory_is_picked_up_incrementally() {
    let fixture = Fixture::new(&[
        (
            "svc/main.go",
            "package main\nimport \"example.com/svc/api\"\n",
        ),
        ("svc/api/api.go", "package api\n"),
    ]);
    let mut indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    fixture.write("svc/go.mod", "module example.com/svc\n");
    assert_eq!(indexer.update_file("svc/go.mod").unwrap(), Change::Updated);
    assert_eq!(edges(&indexer), vec![pair("svc/main.go", "svc/api/api.go")]);
}
