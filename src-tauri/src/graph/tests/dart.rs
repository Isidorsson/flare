use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, pair, Fixture};

fn app() -> Fixture {
    Fixture::new(&[
        ("pubspec.yaml", "name: my_app\nversion: 1.0.0\n"),
        (
            "lib/main.dart",
            "import 'dart:io';\nimport 'package:flutter/material.dart';\nimport 'package:my_app/src/util.dart';\nimport 'widgets/button.dart';\nexport 'src/api.dart';\npart 'main.g.dart';\n",
        ),
        ("lib/src/util.dart", "import '../widgets/button.dart';\n"),
        ("lib/src/api.dart", "export 'stub.dart' if (dart.library.html) 'web.dart';\n"),
        ("lib/src/stub.dart", ""),
        ("lib/src/web.dart", ""),
        ("lib/widgets/button.dart", ""),
        ("lib/main.g.dart", "part of 'main.dart';\n"),
        ("test/main_test.dart", "import 'package:my_app/main.dart';\n"),
    ])
}

#[test]
fn package_relative_export_part_and_conditional_imports_resolve() {
    let indexer = app().index();
    assert_eq!(
        edges(&indexer),
        vec![
            pair("lib/main.dart", "lib/main.g.dart"),
            pair("lib/main.dart", "lib/src/api.dart"),
            pair("lib/main.dart", "lib/src/util.dart"),
            pair("lib/main.dart", "lib/widgets/button.dart"),
            pair("lib/src/api.dart", "lib/src/stub.dart"),
            pair("lib/src/api.dart", "lib/src/web.dart"),
            pair("lib/src/util.dart", "lib/widgets/button.dart"),
            pair("test/main_test.dart", "lib/main.dart"),
        ]
    );
}

#[test]
fn sdk_and_third_party_packages_create_no_edges() {
    let fixture = Fixture::new(&[
        ("pubspec.yaml", "name: app\n"),
        (
            "lib/a.dart",
            "import 'dart:async';\nimport 'package:http/http.dart';\nimport 'missing.dart';\n",
        ),
    ]);
    let indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    assert_eq!(language_of(&indexer, "lib/a.dart"), Some(Language::Dart));
}

#[test]
fn packages_resolve_across_a_monorepo() {
    let fixture = Fixture::new(&[
        ("packages/core/pubspec.yaml", "name: core\n"),
        ("packages/core/lib/core.dart", ""),
        ("apps/shell/pubspec.yaml", "name: shell\n"),
        (
            "apps/shell/lib/main.dart",
            "import 'package:core/core.dart';\n",
        ),
    ]);
    assert_eq!(
        edges(&fixture.index()),
        vec![pair(
            "apps/shell/lib/main.dart",
            "packages/core/lib/core.dart"
        )]
    );
}

#[test]
fn editing_pubspec_yaml_re_resolves_package_imports() {
    let fixture = app();
    let mut indexer = fixture.index();
    assert!(imports_of(&indexer, "test/main_test.dart").contains(&"lib/main.dart".to_string()));
    fixture.write("pubspec.yaml", "name: renamed\n");
    assert_eq!(
        indexer.update_file("pubspec.yaml").unwrap(),
        Change::Updated
    );
    assert!(imports_of(&indexer, "test/main_test.dart").is_empty());
    assert_eq!(imports_of(&indexer, "lib/main.dart").len(), 3);
}

#[test]
fn adding_the_imported_file_resolves_a_dangling_import() {
    let fixture = Fixture::new(&[("lib/a.dart", "import 'later.dart';\n")]);
    let mut indexer = fixture.index();
    fixture.write("lib/later.dart", "");
    assert_eq!(
        indexer.update_file("lib/later.dart").unwrap(),
        Change::Added
    );
    assert_eq!(edges(&indexer), vec![pair("lib/a.dart", "lib/later.dart")]);
}

#[test]
fn editing_an_import_updates_the_edge() {
    let fixture = Fixture::new(&[
        ("a.dart", "import 'b.dart';\n"),
        ("b.dart", ""),
        ("c.dart", ""),
    ]);
    let mut indexer = fixture.index();
    fixture.write("a.dart", "import 'c.dart';\n");
    assert_eq!(indexer.update_file("a.dart").unwrap(), Change::Updated);
    assert_eq!(edges(&indexer), vec![pair("a.dart", "c.dart")]);
}
