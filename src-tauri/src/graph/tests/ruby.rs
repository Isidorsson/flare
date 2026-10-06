use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, pair, Fixture};

fn gem() -> Fixture {
    Fixture::new(&[
        (
            "lib/mygem.rb",
            "require 'json'\nrequire_relative 'mygem/version'\nrequire 'mygem/core'\nautoload :Extras, 'mygem/extras'\n",
        ),
        ("lib/mygem/version.rb", "module Mygem; VERSION = '1'; end\n"),
        ("lib/mygem/core.rb", "require_relative '../mygem'\n"),
        ("lib/mygem/extras.rb", ""),
        ("spec/core_spec.rb", "require 'mygem'\nrequire_relative '../lib/mygem/core'\nrequire 'rspec'\n"),
    ])
}

#[test]
fn require_relative_and_lib_requires_resolve_to_files() {
    let indexer = gem().index();
    assert_eq!(
        edges(&indexer),
        vec![
            pair("lib/mygem.rb", "lib/mygem/core.rb"),
            pair("lib/mygem.rb", "lib/mygem/extras.rb"),
            pair("lib/mygem.rb", "lib/mygem/version.rb"),
            pair("lib/mygem/core.rb", "lib/mygem.rb"),
            pair("spec/core_spec.rb", "lib/mygem.rb"),
            pair("spec/core_spec.rb", "lib/mygem/core.rb"),
        ]
    );
}

#[test]
fn external_gems_and_computed_paths_create_no_edges() {
    let fixture = Fixture::new(&[(
        "a.rb",
        "require 'rails'\nrequire File.join(__dir__, 'b')\nrequire \"x#{y}\"\nrequire_relative 'missing'\n",
    )]);
    let indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    assert_eq!(language_of(&indexer, "a.rb"), Some(Language::Ruby));
}

#[test]
fn adding_the_required_file_resolves_a_dangling_require_relative() {
    let fixture = Fixture::new(&[("a.rb", "require_relative 'later'\n")]);
    let mut indexer = fixture.index();
    fixture.write("later.rb", "");
    assert_eq!(indexer.update_file("later.rb").unwrap(), Change::Added);
    assert_eq!(edges(&indexer), vec![pair("a.rb", "later.rb")]);
}

#[test]
fn editing_a_require_updates_the_edge() {
    let fixture = Fixture::new(&[
        ("a.rb", "require_relative 'b'\n"),
        ("b.rb", ""),
        ("c.rb", ""),
    ]);
    let mut indexer = fixture.index();
    fixture.write("a.rb", "require_relative 'c'\n");
    assert_eq!(indexer.update_file("a.rb").unwrap(), Change::Updated);
    assert_eq!(imports_of(&indexer, "a.rb"), ["c.rb"]);
}

#[test]
fn removing_a_required_file_drops_the_edge() {
    let fixture = gem();
    let mut indexer = fixture.index();
    fixture.delete("lib/mygem/version.rb");
    assert_eq!(
        indexer.remove_file("lib/mygem/version.rb").unwrap(),
        Change::Removed
    );
    assert!(!imports_of(&indexer, "lib/mygem.rb").contains(&"lib/mygem/version.rb".to_string()));
}
