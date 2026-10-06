use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, pair, Fixture};

fn project() -> Fixture {
    Fixture::new(&[
        (
            "src/main.zig",
            "const std = @import(\"std\");\nconst util = @import(\"util.zig\");\nconst deep = @import(\"sub/deep.zig\").thing;\nconst c = @cImport(@cInclude(\"x.h\"));\n",
        ),
        ("src/util.zig", "const root = @import(\"../build_options.zig\");\n"),
        ("src/sub/deep.zig", ""),
        ("build_options.zig", ""),
    ])
}

#[test]
fn file_imports_resolve_relative_to_the_importing_file() {
    let indexer = project().index();
    assert_eq!(
        edges(&indexer),
        vec![
            pair("src/main.zig", "src/sub/deep.zig"),
            pair("src/main.zig", "src/util.zig"),
            pair("src/util.zig", "build_options.zig"),
        ]
    );
}

#[test]
fn named_modules_and_missing_files_create_no_edges() {
    let fixture = Fixture::new(&[(
        "a.zig",
        "const s = @import(\"std\");\nconst b = @import(\"builtin\");\nconst m = @import(\"missing.zig\");\n",
    )]);
    let indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    assert_eq!(language_of(&indexer, "a.zig"), Some(Language::Zig));
}

#[test]
fn adding_the_imported_file_resolves_a_dangling_import() {
    let fixture = Fixture::new(&[("a.zig", "const l = @import(\"later.zig\");\n")]);
    let mut indexer = fixture.index();
    fixture.write("later.zig", "");
    assert_eq!(indexer.update_file("later.zig").unwrap(), Change::Added);
    assert_eq!(edges(&indexer), vec![pair("a.zig", "later.zig")]);
}

#[test]
fn editing_an_import_updates_the_edge() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.write("src/main.zig", "const u = @import(\"util.zig\");\n");
    assert_eq!(
        indexer.update_file("src/main.zig").unwrap(),
        Change::Updated
    );
    assert_eq!(imports_of(&indexer, "src/main.zig"), ["src/util.zig"]);
}

#[test]
fn removing_the_imported_file_drops_the_edge() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.delete("src/sub");
    assert_eq!(indexer.remove_file("src/sub").unwrap(), Change::Removed);
    assert_eq!(imports_of(&indexer, "src/main.zig"), ["src/util.zig"]);
}
