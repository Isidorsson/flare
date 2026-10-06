use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, pair, Fixture};

const COMPOSER: &str = r#"{
  "name": "acme/app",
  "autoload": { "psr-4": { "App\\": "src/", "App\\Legacy\\": ["legacy/", "old/"] } },
  "autoload-dev": { "psr-4": { "Tests\\": "tests/" } }
}"#;

fn project() -> Fixture {
    Fixture::new(&[
        ("composer.json", COMPOSER),
        (
            "public/index.php",
            "<?php\nrequire __DIR__ . '/../bootstrap.php';\nrequire_once 'helpers.php';\ninclude dirname(__DIR__) . '/config/app.php';\nuse App\\Models\\User;\nuse App\\Services\\{Mailer, Queue as Q};\nuse Symfony\\Component\\Console\\Command;\n",
        ),
        ("bootstrap.php", "<?php\n"),
        ("public/helpers.php", "<?php\n"),
        ("config/app.php", "<?php\n"),
        ("src/Models/User.php", "<?php\nnamespace App\\Models;\nclass User {}\n"),
        ("src/Services/Mailer.php", "<?php\nnamespace App\\Services;\nclass Mailer {}\n"),
        ("src/Services/Queue.php", "<?php\nnamespace App\\Services;\nclass Queue {}\n"),
        ("legacy/Old.php", "<?php\nnamespace App\\Legacy;\nclass Old {}\n"),
        (
            "tests/UserTest.php",
            "<?php\nuse App\\Models\\User;\nuse App\\Legacy\\Old;\nuse Tests\\Helper;\n",
        ),
        ("tests/Helper.php", "<?php\nnamespace Tests;\n"),
    ])
}

#[test]
fn literal_and_directory_anchored_includes_resolve() {
    let indexer = project().index();
    let targets = imports_of(&indexer, "public/index.php");
    for expected in ["bootstrap.php", "public/helpers.php", "config/app.php"] {
        assert!(
            targets.contains(&expected.to_string()),
            "{expected} in {targets:?}"
        );
    }
}

#[test]
fn use_statements_resolve_through_psr4_including_groups_and_aliases() {
    let indexer = project().index();
    assert_eq!(
        imports_of(&indexer, "public/index.php"),
        [
            "bootstrap.php",
            "config/app.php",
            "public/helpers.php",
            "src/Models/User.php",
            "src/Services/Mailer.php",
            "src/Services/Queue.php",
        ]
    );
}

#[test]
fn autoload_dev_and_multiple_directories_per_prefix_are_honoured() {
    let indexer = project().index();
    assert_eq!(
        imports_of(&indexer, "tests/UserTest.php"),
        ["legacy/Old.php", "src/Models/User.php", "tests/Helper.php"]
    );
}

#[test]
fn without_composer_json_use_statements_do_not_resolve() {
    let fixture = Fixture::new(&[
        ("a.php", "<?php\nuse App\\Thing;\n"),
        ("src/Thing.php", "<?php\n"),
    ]);
    let indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    assert_eq!(language_of(&indexer, "a.php"), Some(Language::Php));
}

#[test]
fn unknown_vendor_classes_and_computed_includes_create_no_edges() {
    let fixture = Fixture::new(&[
        ("composer.json", COMPOSER),
        (
            "a.php",
            "<?php\nuse Vendor\\Pkg\\Thing;\nuse function App\\helper;\nrequire $path;\nrequire __DIR__ . '/missing.php';\n",
        ),
    ]);
    assert!(edges(&fixture.index()).is_empty());
}

#[test]
fn editing_composer_json_re_resolves_use_statements() {
    let fixture = project();
    let mut indexer = fixture.index();
    assert!(imports_of(&indexer, "tests/UserTest.php").contains(&"src/Models/User.php".to_string()));
    fixture.write(
        "composer.json",
        r#"{ "autoload": { "psr-4": { "App\\": "app/" } } }"#,
    );
    assert_eq!(
        indexer.update_file("composer.json").unwrap(),
        Change::Updated
    );
    assert!(imports_of(&indexer, "tests/UserTest.php").is_empty());
    fixture.write("app/Models/User.php", "<?php\nnamespace App\\Models;\n");
    indexer.update_file("app/Models/User.php").unwrap();
    assert_eq!(
        imports_of(&indexer, "tests/UserTest.php"),
        ["app/Models/User.php"]
    );
}

#[test]
fn adding_a_class_file_resolves_a_dangling_use() {
    let fixture = Fixture::new(&[
        (
            "composer.json",
            r#"{ "autoload": { "psr-4": { "App\\": "src/" } } }"#,
        ),
        ("main.php", "<?php\nuse App\\Later;\n"),
    ]);
    let mut indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    fixture.write("src/Later.php", "<?php\n");
    assert_eq!(indexer.update_file("src/Later.php").unwrap(), Change::Added);
    assert_eq!(edges(&indexer), vec![pair("main.php", "src/Later.php")]);
}

#[test]
fn an_invalid_composer_json_is_a_warning_not_a_failure() {
    let fixture = Fixture::new(&[("composer.json", "{ not json"), ("a.php", "<?php\n")]);
    let snapshot = fixture.index().snapshot();
    assert_eq!(snapshot.nodes.len(), 1);
    assert!(
        snapshot
            .warnings
            .iter()
            .any(|warning| warning.contains("composer.json")),
        "{:?}",
        snapshot.warnings
    );
}
