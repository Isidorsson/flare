use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, pair, Fixture};

fn project() -> Fixture {
    Fixture::new(&[
        (
            "app/src/main/java/com/acme/Main.java",
            "package com.acme;\n\nimport com.acme.util.Strings;\nimport static com.acme.util.Strings.join;\nimport com.acme.model.*;\nimport java.util.List;\n\npublic class Main {}\n",
        ),
        (
            "app/src/main/java/com/acme/util/Strings.java",
            "package com.acme.util;\n\npublic class Strings {}\n",
        ),
        (
            "app/src/main/java/com/acme/model/User.java",
            "package com.acme.model;\n\npublic class User {}\n",
        ),
        (
            "app/src/main/java/com/acme/model/Order.java",
            "package com.acme.model;\n\npublic class Order {}\n",
        ),
        (
            "app/src/main/kotlin/com/acme/App.kt",
            "package com.acme\n\nimport com.acme.util.Strings\nimport com.acme.util.helper\nimport com.acme.model.User as Person\n\nclass App\n",
        ),
        (
            "app/src/main/kotlin/com/acme/util/Helpers.kt",
            "package com.acme.util\n\nfun helper() {}\n",
        ),
    ])
}

#[test]
fn java_imports_link_classes_static_members_and_wildcard_packages() {
    let indexer = project().index();
    assert_eq!(
        imports_of(&indexer, "app/src/main/java/com/acme/Main.java"),
        [
            "app/src/main/java/com/acme/model/Order.java",
            "app/src/main/java/com/acme/model/User.java",
            "app/src/main/java/com/acme/util/Strings.java",
        ]
    );
}

#[test]
fn kotlin_imports_link_classes_top_level_functions_and_aliases() {
    let indexer = project().index();
    assert_eq!(
        imports_of(&indexer, "app/src/main/kotlin/com/acme/App.kt"),
        [
            "app/src/main/java/com/acme/model/User.java",
            "app/src/main/java/com/acme/util/Strings.java",
            "app/src/main/kotlin/com/acme/util/Helpers.kt",
        ]
    );
}

#[test]
fn library_imports_create_no_edges_and_nodes_carry_their_labels() {
    let fixture = Fixture::new(&[
        (
            "A.java",
            "import java.util.List;\nimport org.junit.Test;\nclass A {}\n",
        ),
        ("B.kt", "import kotlin.collections.List\nfun b() {}\n"),
    ]);
    let indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    assert_eq!(language_of(&indexer, "A.java"), Some(Language::Java));
    assert_eq!(language_of(&indexer, "B.kt"), Some(Language::Kotlin));
}

#[test]
fn files_without_a_package_resolve_through_conventional_source_roots() {
    let fixture = Fixture::new(&[
        (
            "svc/src/main/java/Main.java",
            "import org.x.Thing;\nclass Main {}\n",
        ),
        ("svc/src/main/kotlin/org/x/Thing.kt", "class Thing\n"),
    ]);
    assert_eq!(
        imports_of(&fixture.index(), "svc/src/main/java/Main.java"),
        ["svc/src/main/kotlin/org/x/Thing.kt"]
    );
}

#[test]
fn changing_a_package_declaration_re_resolves_importers() {
    let fixture = Fixture::new(&[
        (
            "x/Main.java",
            "package app;
import com.acme.util.Strings;
class Main {}
",
        ),
        (
            "y/z/Strings.java",
            "package com.acme.util;
public class Strings {}
",
        ),
    ]);
    let mut indexer = fixture.index();
    assert_eq!(
        edges(&indexer),
        vec![pair("x/Main.java", "y/z/Strings.java")]
    );
    fixture.write(
        "y/z/Strings.java",
        "package com.acme.text;
public class Strings {}
",
    );
    assert_eq!(
        indexer.update_file("y/z/Strings.java").unwrap(),
        Change::Updated
    );
    assert!(edges(&indexer).is_empty());
}

#[test]
fn adding_a_class_to_an_imported_package_updates_wildcard_importers() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.write(
        "app/src/main/java/com/acme/model/Invoice.java",
        "package com.acme.model;\n\npublic class Invoice {}\n",
    );
    assert_eq!(
        indexer
            .update_file("app/src/main/java/com/acme/model/Invoice.java")
            .unwrap(),
        Change::Added
    );
    assert!(imports_of(&indexer, "app/src/main/java/com/acme/Main.java")
        .contains(&"app/src/main/java/com/acme/model/Invoice.java".to_string()));
}

#[test]
fn editing_an_import_updates_the_edge() {
    let fixture = Fixture::new(&[
        ("a/A.java", "package a;\nimport b.B;\nclass A {}\n"),
        ("b/B.java", "package b;\nclass B {}\n"),
        ("c/C.java", "package c;\nclass C {}\n"),
    ]);
    let mut indexer = fixture.index();
    assert_eq!(edges(&indexer), vec![pair("a/A.java", "b/B.java")]);
    fixture.write("a/A.java", "package a;\nimport c.C;\nclass A {}\n");
    assert_eq!(indexer.update_file("a/A.java").unwrap(), Change::Updated);
    assert_eq!(edges(&indexer), vec![pair("a/A.java", "c/C.java")]);
}

#[test]
fn removing_the_imported_file_drops_the_edge() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.delete("app/src/main/kotlin/com/acme/util/Helpers.kt");
    indexer
        .remove_file("app/src/main/kotlin/com/acme/util/Helpers.kt")
        .unwrap();
    assert_eq!(
        imports_of(&indexer, "app/src/main/kotlin/com/acme/App.kt"),
        [
            "app/src/main/java/com/acme/model/User.java",
            "app/src/main/java/com/acme/util/Strings.java",
        ]
    );
}
