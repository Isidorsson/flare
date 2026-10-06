use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, pair, Fixture};

fn project() -> Fixture {
    Fixture::new(&[
        (
            "Program.cs",
            "using System;\nusing App.Models;\nusing static App.Util.Strings;\n\nclass Program { static void Main() {} }\n",
        ),
        (
            "Models/User.cs",
            "namespace App.Models;\n\npublic class User {}\n",
        ),
        (
            "Models/Order.cs",
            "namespace App.Models\n{\n    public class Order {}\n}\n",
        ),
        (
            "Util/Strings.cs",
            "namespace App\n{\n    namespace Util\n    {\n        public static class Strings {}\n    }\n}\n",
        ),
        ("Other/Thing.cs", "namespace App.Other;\nusing App.Models;\n"),
    ])
}

#[test]
fn a_using_links_every_file_declaring_the_namespace() {
    let indexer = project().index();
    assert_eq!(
        imports_of(&indexer, "Program.cs"),
        ["Models/Order.cs", "Models/User.cs", "Util/Strings.cs"]
    );
    assert_eq!(
        imports_of(&indexer, "Other/Thing.cs"),
        ["Models/Order.cs", "Models/User.cs"]
    );
}

#[test]
fn nested_block_namespaces_compose_their_full_name() {
    let fixture = Fixture::new(&[
        ("A.cs", "using Outer.Inner;\n"),
        (
            "B.cs",
            "namespace Outer { namespace Inner { class B {} } }\n",
        ),
    ]);
    assert_eq!(edges(&fixture.index()), vec![pair("A.cs", "B.cs")]);
}

#[test]
fn framework_and_unknown_namespaces_create_no_edges() {
    let fixture = Fixture::new(&[(
        "A.cs",
        "using System;\nusing System.Linq;\nusing Newtonsoft.Json;\nusing Alias = System.Text.StringBuilder;\n",
    )]);
    let indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    assert_eq!(language_of(&indexer, "A.cs"), Some(Language::CSharp));
}

#[test]
fn editing_a_namespace_declaration_re_resolves_importers() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.write(
        "Models/User.cs",
        "namespace App.Renamed;\n\npublic class User {}\n",
    );
    assert_eq!(
        indexer.update_file("Models/User.cs").unwrap(),
        Change::Updated
    );
    assert_eq!(
        imports_of(&indexer, "Program.cs"),
        ["Models/Order.cs", "Util/Strings.cs"]
    );
}

#[test]
fn declaring_a_new_namespace_nobody_uses_changes_no_edges() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.write(
        "Other/Thing.cs",
        "namespace App.Unused;\nusing App.Models;\n",
    );
    assert_eq!(
        indexer.update_file("Other/Thing.cs").unwrap(),
        Change::Unchanged
    );
}

#[test]
fn adding_a_file_to_a_namespace_links_it_from_importers() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.write("Models/Invoice.cs", "namespace App.Models;\n");
    assert_eq!(
        indexer.update_file("Models/Invoice.cs").unwrap(),
        Change::Added
    );
    assert!(imports_of(&indexer, "Program.cs").contains(&"Models/Invoice.cs".to_string()));
}

#[test]
fn removing_the_only_declaring_file_drops_the_edge() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.delete("Util/Strings.cs");
    assert_eq!(
        indexer.remove_file("Util/Strings.cs").unwrap(),
        Change::Removed
    );
    assert_eq!(
        imports_of(&indexer, "Program.cs"),
        ["Models/Order.cs", "Models/User.cs"]
    );
}

#[test]
fn a_using_inside_a_namespace_block_still_links() {
    let fixture = Fixture::new(&[
        ("A.cs", "namespace X { using Lib; class A {} }\n"),
        ("B.cs", "namespace Lib;\n"),
    ]);
    assert_eq!(edges(&fixture.index()), vec![pair("A.cs", "B.cs")]);
}
