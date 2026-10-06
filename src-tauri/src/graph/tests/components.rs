use crate::graph::model::{Change, Language};

use super::{edges, imports_of, language_of, pair, Fixture};

fn app() -> Fixture {
    Fixture::new(&[
        (
            "src/App.vue",
            "<template>\n  <Button />\n</template>\n\n<script setup lang=\"ts\">\nimport Button from './components/Button.vue';\nimport { util } from '@/lib/util';\nimport { ref } from 'vue';\n</script>\n\n<style>\n@import './x.css';\n</style>\n",
        ),
        ("src/components/Button.vue", "<script>\nimport helper from '../lib/helper.js';\nexport default {};\n</script>\n"),
        ("src/lib/util.ts", ""),
        ("src/lib/helper.js", ""),
        (
            "tsconfig.json",
            r#"{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }"#,
        ),
        (
            "web/Page.svelte",
            "<script lang=\"ts\">\n  import Card from './Card.svelte';\n  import { store } from './store';\n</script>\n\n<Card />\n<style>.a { color: red }</style>\n",
        ),
        ("web/Card.svelte", "<script context=\"module\">\nimport { x } from './x.js';\n</script>\n<script>\nimport './y.js';\n</script>\n"),
        ("web/store.ts", ""),
        ("web/x.js", ""),
        ("web/y.js", ""),
    ])
}

#[test]
fn vue_script_imports_resolve_with_relative_paths_and_tsconfig_aliases() {
    let indexer = app().index();
    assert_eq!(
        imports_of(&indexer, "src/App.vue"),
        ["src/components/Button.vue", "src/lib/util.ts"]
    );
    assert_eq!(
        imports_of(&indexer, "src/components/Button.vue"),
        ["src/lib/helper.js"]
    );
}

#[test]
fn svelte_script_imports_resolve_including_module_and_instance_scripts() {
    let indexer = app().index();
    assert_eq!(
        imports_of(&indexer, "web/Page.svelte"),
        ["web/Card.svelte", "web/store.ts"]
    );
    assert_eq!(
        imports_of(&indexer, "web/Card.svelte"),
        ["web/x.js", "web/y.js"]
    );
}

#[test]
fn components_are_nodes_with_their_own_labels() {
    let indexer = app().index();
    assert_eq!(language_of(&indexer, "src/App.vue"), Some(Language::Vue));
    assert_eq!(
        language_of(&indexer, "web/Page.svelte"),
        Some(Language::Svelte)
    );
}

#[test]
fn script_files_can_import_components() {
    let fixture = Fixture::new(&[
        (
            "main.ts",
            "import App from './App.vue';\nimport Page from './Page.svelte';\n",
        ),
        ("App.vue", "<template/>\n"),
        ("Page.svelte", ""),
    ]);
    assert_eq!(
        edges(&fixture.index()),
        vec![pair("main.ts", "App.vue"), pair("main.ts", "Page.svelte")]
    );
}

#[test]
fn components_without_scripts_or_with_commented_scripts_have_no_edges() {
    let fixture = Fixture::new(&[
        (
            "a.vue",
            "<template><p>hi</p></template>\n<!-- <script>import './b'</script> -->\n",
        ),
        ("b.js", ""),
    ]);
    let indexer = fixture.index();
    assert!(edges(&indexer).is_empty());
    assert_eq!(imports_of(&indexer, "a.vue").len(), 0);
}

#[test]
fn unresolved_imports_create_no_edges() {
    let fixture = Fixture::new(&[(
        "a.svelte",
        "<script>\nimport x from './missing';\nimport y from 'svelte/store';\n</script>\n",
    )]);
    assert!(edges(&fixture.index()).is_empty());
}

#[test]
fn editing_the_script_updates_the_edges() {
    let fixture = app();
    let mut indexer = fixture.index();
    fixture.write(
        "web/Page.svelte",
        "<script>\nimport { store } from './store';\n</script>\n",
    );
    assert_eq!(
        indexer.update_file("web/Page.svelte").unwrap(),
        Change::Updated
    );
    assert_eq!(imports_of(&indexer, "web/Page.svelte"), ["web/store.ts"]);
}

#[test]
fn adding_the_imported_component_resolves_a_dangling_import() {
    let fixture = Fixture::new(&[("a.vue", "<script>\nimport B from './B.vue';\n</script>\n")]);
    let mut indexer = fixture.index();
    fixture.write("B.vue", "<template/>\n");
    assert_eq!(indexer.update_file("B.vue").unwrap(), Change::Added);
    assert_eq!(edges(&indexer), vec![pair("a.vue", "B.vue")]);
}
