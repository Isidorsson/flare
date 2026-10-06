use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, node_ids, pair, Fixture};

fn project() -> Fixture {
    Fixture::new(&[
        (
            "src/main.c",
            "#include <stdio.h>\n#include \"util.h\"\n#include \"lib/api.h\"\n#include \"missing.h\"\n",
        ),
        ("src/util.h", "#pragma once\n#include \"util_impl.h\"\n"),
        ("src/util_impl.h", ""),
        ("include/lib/api.h", ""),
        (
            "src/widget.cpp",
            "#include \"widget.hpp\"\n#include <vector>\n",
        ),
        ("src/widget.hpp", "#pragma once\nnamespace w { class A {}; }\n"),
    ])
}

#[test]
fn quoted_includes_resolve_beside_the_file_then_through_include_directories() {
    let indexer = project().index();
    assert_eq!(
        edges(&indexer),
        vec![
            pair("src/main.c", "include/lib/api.h"),
            pair("src/main.c", "src/util.h"),
            pair("src/util.h", "src/util_impl.h"),
            pair("src/widget.cpp", "src/widget.hpp"),
        ]
    );
}

#[test]
fn system_and_unknown_headers_create_no_edges() {
    let fixture = Fixture::new(&[
        (
            "a.c",
            "#include <stdio.h>\n#include <vector>\n#include \"nope.h\"\n",
        ),
        ("stdio.h", ""),
    ]);
    assert!(edges(&fixture.index()).is_empty());
}

#[test]
fn every_c_and_cpp_extension_is_a_node_with_the_right_label() {
    let files = [
        ("a.c", Language::C),
        ("a.h", Language::C),
        ("b.cc", Language::Cpp),
        ("b.cpp", Language::Cpp),
        ("b.cxx", Language::Cpp),
        ("b.hpp", Language::Cpp),
        ("b.hh", Language::Cpp),
    ];
    let fixture = Fixture::new(&files.map(|(path, _)| (path, "")));
    let indexer = fixture.index();
    for (path, language) in files {
        assert_eq!(language_of(&indexer, path), Some(language), "{path}");
    }
}

#[test]
fn cpp_constructs_in_a_dot_h_header_keep_their_includes() {
    let fixture = Fixture::new(&[
        (
            "api.h",
            "#pragma once\n#include \"types.h\"\nnamespace api { template<typename T> class Box { public: T get(); }; }\n",
        ),
        ("types.h", ""),
    ]);
    assert_eq!(edges(&fixture.index()), vec![pair("api.h", "types.h")]);
}

#[test]
fn adding_a_closer_header_redirects_the_edge() {
    let fixture = Fixture::new(&[
        ("src/app/main.c", "#include \"x.h\"\n"),
        ("include/x.h", ""),
    ]);
    let mut indexer = fixture.index();
    assert_eq!(imports_of(&indexer, "src/app/main.c"), ["include/x.h"]);
    fixture.write("src/app/x.h", "");
    assert_eq!(indexer.update_file("src/app/x.h").unwrap(), Change::Added);
    assert_eq!(imports_of(&indexer, "src/app/main.c"), ["src/app/x.h"]);
}

#[test]
fn editing_includes_updates_edges() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.write("src/main.c", "#include \"util_impl.h\"\n");
    assert_eq!(indexer.update_file("src/main.c").unwrap(), Change::Updated);
    assert_eq!(imports_of(&indexer, "src/main.c"), ["src/util_impl.h"]);
}

#[test]
fn removing_a_header_drops_the_edges_into_it() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.delete("src/util.h");
    assert_eq!(indexer.remove_file("src/util.h").unwrap(), Change::Removed);
    assert!(!node_ids(&indexer).contains(&"src/util.h".to_string()));
    assert_eq!(imports_of(&indexer, "src/main.c"), ["include/lib/api.h"]);
}
