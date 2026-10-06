use super::{edges, imports_of, node_ids, pair, Fixture};

const TSCONFIG_WITH_COMMENTS: &str = r#"{
  // path aliases like the app's own tsconfig
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./src/*"], },
  },
}"#;

fn app_fixture() -> Fixture {
    Fixture::new(&[
        ("tsconfig.json", TSCONFIG_WITH_COMMENTS),
        (
            "src/main.tsx",
            "import React from 'react';\nimport { App } from '@/features/app/App';\nimport './styles.css';\nimport logo from './logo.svg';\n",
        ),
        (
            "src/features/app/App.tsx",
            "import { util } from '../../shared/util';\nimport { Panel } from './Panel';\nexport const lazy = () => import('@/features/lazy');\n",
        ),
        ("src/features/app/Panel.tsx", "import { util } from '@/shared/util';\n"),
        ("src/shared/util.ts", "export const util = 1;\n"),
        ("src/features/lazy/index.ts", "export * from './impl';\n"),
        ("src/features/lazy/impl.ts", "export const impl = 1;\n"),
        ("src/styles.css", "body {}"),
        ("src/logo.svg", "<svg/>"),
    ])
}

#[test]
fn builds_edges_for_relative_alias_dynamic_and_reexport_imports() {
    let indexer = app_fixture().index();
    assert_eq!(
        edges(&indexer),
        vec![
            pair("src/features/app/App.tsx", "src/features/app/Panel.tsx"),
            pair("src/features/app/App.tsx", "src/features/lazy/index.ts"),
            pair("src/features/app/App.tsx", "src/shared/util.ts"),
            pair("src/features/app/Panel.tsx", "src/shared/util.ts"),
            pair("src/features/lazy/index.ts", "src/features/lazy/impl.ts"),
            pair("src/main.tsx", "src/features/app/App.tsx"),
            pair("src/main.tsx", "src/styles.css"),
        ]
    );
}

#[test]
fn packages_and_unindexed_assets_create_no_edges_but_stylesheets_do() {
    let indexer = app_fixture().index();
    let targets = imports_of(&indexer, "src/main.tsx");
    assert_eq!(targets, ["src/features/app/App.tsx", "src/styles.css"]);
}

#[test]
fn alias_without_a_tsconfig_does_not_resolve() {
    let fixture = Fixture::new(&[("src/a.ts", "import { b } from '@/b';"), ("src/b.ts", "")]);
    assert!(edges(&fixture.index()).is_empty());
}

#[test]
fn nested_tsconfigs_scope_their_aliases_to_their_package() {
    let fixture = Fixture::new(&[
        (
            "web/tsconfig.json",
            r#"{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } } }"#,
        ),
        ("web/src/a.ts", "import { x } from '~/lib/x';"),
        ("web/src/lib/x.ts", ""),
        ("server/src/b.ts", "import { x } from '~/lib/x';"),
        ("server/src/lib/x.ts", ""),
    ]);
    assert_eq!(
        edges(&fixture.index()),
        vec![pair("web/src/a.ts", "web/src/lib/x.ts")]
    );
}

#[test]
fn nodenext_style_js_specifiers_resolve_to_typescript_sources() {
    let fixture = Fixture::new(&[
        (
            "src/a.ts",
            "import { b } from './b.js';\nimport { c } from './c.js';",
        ),
        ("src/b.ts", ""),
        ("src/c.tsx", ""),
    ]);
    assert_eq!(
        imports_of(&fixture.index(), "src/a.ts"),
        ["src/b.ts", "src/c.tsx"]
    );
}

#[test]
fn commonjs_require_and_mixed_javascript_extensions() {
    let fixture = Fixture::new(&[
        (
            "lib/entry.js",
            "const a = require('./a');\nconst b = require('./b.cjs');\nimport('./c.mjs');",
        ),
        ("lib/a/index.js", ""),
        ("lib/b.cjs", ""),
        ("lib/c.mjs", ""),
    ]);
    assert_eq!(
        imports_of(&fixture.index(), "lib/entry.js"),
        ["lib/a/index.js", "lib/b.cjs", "lib/c.mjs"]
    );
}

#[test]
fn self_imports_are_dropped_and_cycles_are_kept() {
    let fixture = Fixture::new(&[
        ("a.ts", "import './a';\nimport './b';"),
        ("b.ts", "import './a';"),
    ]);
    assert_eq!(
        edges(&fixture.index()),
        vec![pair("a.ts", "b.ts"), pair("b.ts", "a.ts")]
    );
}

#[test]
fn nodes_carry_their_language() {
    let fixture = Fixture::new(&[("a.ts", ""), ("b.tsx", ""), ("c.js", ""), ("d.jsx", "")]);
    let snapshot = fixture.index().snapshot();
    let labels: Vec<_> = snapshot
        .nodes
        .iter()
        .map(|node| serde_json::to_value(node.language).unwrap())
        .collect();
    assert_eq!(
        labels,
        ["typescript", "typescript", "javascript", "javascript"]
    );
}

fn monorepo_fixture() -> Fixture {
    Fixture::new(&[
        (
            "package.json",
            r#"{ "name": "app", "workspaces": ["protocol", "bridge"] }"#,
        ),
        (
            "protocol/package.json",
            r#"{ "name": "@flare/protocol", "exports": { ".": "./src/index.ts" } }"#,
        ),
        ("protocol/src/index.ts", "export * from './schemas';"),
        ("protocol/src/schemas.ts", ""),
        (
            "bridge/package.json",
            r#"{ "name": "@flare/bridge", "dependencies": { "@flare/protocol": "workspace:*" } }"#,
        ),
        (
            "bridge/src/main.ts",
            "import { a } from '@flare/protocol';\nimport { b } from '@flare/protocol/src/schemas';\nimport { z } from 'zod';\n",
        ),
        ("src/App.tsx", "import { Msg } from '@flare/protocol';\n"),
        (
            "node_modules/@flare/protocol/package.json",
            r#"{ "name": "@flare/protocol", "main": "vendored.js" }"#,
        ),
        ("node_modules/@flare/protocol/vendored.js", ""),
    ])
}

#[test]
fn workspace_packages_resolve_to_their_entry_and_subpath_files() {
    let indexer = monorepo_fixture().index();
    assert_eq!(
        edges(&indexer),
        vec![
            pair("bridge/src/main.ts", "protocol/src/index.ts"),
            pair("bridge/src/main.ts", "protocol/src/schemas.ts"),
            pair("protocol/src/index.ts", "protocol/src/schemas.ts"),
            pair("src/App.tsx", "protocol/src/index.ts"),
        ]
    );
}

#[test]
fn vendored_copies_in_node_modules_never_become_nodes_or_package_roots() {
    let indexer = monorepo_fixture().index();
    assert!(node_ids(&indexer)
        .iter()
        .all(|id| !id.starts_with("node_modules")));
}

#[test]
fn bundler_query_suffixes_still_resolve() {
    let fixture = Fixture::new(&[
        (
            "a.ts",
            "import raw from './b.ts?raw';\nimport w from './c?worker';",
        ),
        ("b.ts", ""),
        ("c.ts", ""),
    ]);
    assert_eq!(imports_of(&fixture.index(), "a.ts"), ["b.ts", "c.ts"]);
}
