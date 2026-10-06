use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, pair, Fixture};

fn project() -> Fixture {
    Fixture::new(&[
        (
            "scripts/deploy.sh",
            "#!/usr/bin/env bash\nsource ./lib/log.sh\n. \"common.sh\"\nsource $HOME/.profile\nsource \"$DIR/dynamic.sh\"\nif [ -f x ]; then . ./lib/extra.sh; fi\n",
        ),
        ("scripts/lib/log.sh", "source ../../common.sh\n"),
        ("scripts/lib/extra.sh", ""),
        ("common.sh", ""),
    ])
}

#[test]
fn source_and_dot_resolve_relative_to_the_script_or_the_root() {
    let indexer = project().index();
    assert_eq!(
        edges(&indexer),
        vec![
            pair("scripts/deploy.sh", "common.sh"),
            pair("scripts/deploy.sh", "scripts/lib/extra.sh"),
            pair("scripts/deploy.sh", "scripts/lib/log.sh"),
            pair("scripts/lib/log.sh", "common.sh"),
        ]
    );
}

#[test]
fn variable_and_missing_paths_create_no_edges() {
    let fixture = Fixture::new(&[(
        "run.sh",
        "source $LIB/x.sh\nsource \"$(dirname \"$0\")/y.sh\"\nsource missing.sh\nsource ~/.bashrc\n",
    )]);
    let indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    assert_eq!(language_of(&indexer, "run.sh"), Some(Language::Shell));
}

#[test]
fn bash_and_zsh_files_are_indexed_too() {
    let fixture = Fixture::new(&[("a.bash", "source ./b.zsh\n"), ("b.zsh", "")]);
    assert_eq!(edges(&fixture.index()), vec![pair("a.bash", "b.zsh")]);
}

#[test]
fn adding_the_sourced_file_resolves_a_dangling_source() {
    let fixture = Fixture::new(&[("a.sh", "source ./later.sh\n")]);
    let mut indexer = fixture.index();
    fixture.write("later.sh", "");
    assert_eq!(indexer.update_file("later.sh").unwrap(), Change::Added);
    assert_eq!(edges(&indexer), vec![pair("a.sh", "later.sh")]);
}

#[test]
fn editing_a_source_line_updates_the_edge() {
    let fixture = project();
    let mut indexer = fixture.index();
    fixture.write("scripts/deploy.sh", "source ./lib/extra.sh\n");
    assert_eq!(
        indexer.update_file("scripts/deploy.sh").unwrap(),
        Change::Updated
    );
    assert_eq!(
        imports_of(&indexer, "scripts/deploy.sh"),
        ["scripts/lib/extra.sh"]
    );
}
