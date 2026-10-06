use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, pair, Fixture};

fn project() -> Fixture {
    Fixture::new(&[
        (
            "styles/main.scss",
            "@use 'sass:math';\n@use 'vars';\n@forward \"mixins\";\n@import 'legacy', \"components/button\";\n// @import 'commented';\n",
        ),
        ("styles/_vars.scss", ""),
        ("styles/_mixins.scss", "@use './vars' as v;\n"),
        ("styles/legacy.scss", ""),
        ("styles/components/_button.scss", "@use '../vars';\n"),
        (
            "css/site.css",
            "@import \"reset.css\";\n@import url(theme/dark.css) screen;\n@import url(\"https://fonts.example/x.css\");\n",
        ),
        ("css/reset.css", ""),
        ("css/theme/dark.css", ""),
        (
            "less/app.less",
            "@import (reference) \"mixins\";\n@import \"theme.less\";\n",
        ),
        ("less/mixins.less", ""),
        ("less/theme.less", ""),
    ])
}

#[test]
fn scss_use_forward_and_import_resolve_partials_and_extensions() {
    let indexer = project().index();
    assert_eq!(
        imports_of(&indexer, "styles/main.scss"),
        [
            "styles/_mixins.scss",
            "styles/_vars.scss",
            "styles/components/_button.scss",
            "styles/legacy.scss",
        ]
    );
    assert_eq!(
        imports_of(&indexer, "styles/_mixins.scss"),
        ["styles/_vars.scss"]
    );
    assert_eq!(
        imports_of(&indexer, "styles/components/_button.scss"),
        ["styles/_vars.scss"]
    );
}

#[test]
fn css_imports_need_exact_files_and_skip_remote_urls() {
    let indexer = project().index();
    assert_eq!(
        imports_of(&indexer, "css/site.css"),
        ["css/reset.css", "css/theme/dark.css"]
    );
}

#[test]
fn less_imports_infer_the_extension_and_accept_option_lists() {
    let indexer = project().index();
    assert_eq!(
        imports_of(&indexer, "less/app.less"),
        ["less/mixins.less", "less/theme.less"]
    );
}

#[test]
fn all_three_dialects_share_one_language_label() {
    let indexer = project().index();
    for path in ["styles/main.scss", "css/site.css", "less/app.less"] {
        assert_eq!(language_of(&indexer, path), Some(Language::Css), "{path}");
    }
}

#[test]
fn unresolved_and_external_imports_create_no_edges() {
    let fixture = Fixture::new(&[(
        "a.scss",
        "@use 'missing';\n@import 'http://x/y';\n@use 'pkg:thing';\n",
    )]);
    assert!(edges(&fixture.index()).is_empty());
}

#[test]
fn script_imports_of_stylesheets_link_to_the_css_node() {
    let fixture = Fixture::new(&[
        (
            "src/main.ts",
            "import './app.css';\nimport './theme.scss';\n",
        ),
        ("src/app.css", ""),
        ("src/theme.scss", ""),
    ]);
    assert_eq!(
        edges(&fixture.index()),
        vec![
            pair("src/main.ts", "src/app.css"),
            pair("src/main.ts", "src/theme.scss"),
        ]
    );
}

#[test]
fn adding_a_partial_resolves_a_dangling_use() {
    let fixture = Fixture::new(&[("a.scss", "@use 'later';\n")]);
    let mut indexer = fixture.index();
    fixture.write("_later.scss", "");
    assert_eq!(indexer.update_file("_later.scss").unwrap(), Change::Added);
    assert_eq!(edges(&indexer), vec![pair("a.scss", "_later.scss")]);
}

#[test]
fn a_plain_file_shadows_an_index_partial_once_added() {
    let fixture = Fixture::new(&[("a.scss", "@use 'lib';\n"), ("lib/_index.scss", "")]);
    let mut indexer = fixture.index();
    assert_eq!(imports_of(&indexer, "a.scss"), ["lib/_index.scss"]);
    fixture.write("lib.scss", "");
    indexer.update_file("lib.scss").unwrap();
    assert_eq!(imports_of(&indexer, "a.scss"), ["lib.scss"]);
}

#[test]
fn editing_an_import_updates_the_edge() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.write("css/site.css", "@import 'reset.css';\n");
    assert_eq!(
        indexer.update_file("css/site.css").unwrap(),
        Change::Updated
    );
    assert_eq!(imports_of(&indexer, "css/site.css"), ["css/reset.css"]);
}
