mod ecmascript;
mod python;
mod rust_lang;
pub mod tsconfig;
pub mod workspace_packages;

use super::extract::RawImport;
use tsconfig::AliasScopes;
use workspace_packages::WorkspacePackages;

pub struct ResolveContext<'a> {
    pub has_file: &'a dyn Fn(&str) -> bool,
    pub aliases: &'a AliasScopes,
    pub packages: &'a WorkspacePackages,
}

pub fn is_resolution_config(rel: &str) -> bool {
    tsconfig::is_config_file(rel) || workspace_packages::is_manifest(rel)
}

pub fn resolve_import(from: &str, import: &RawImport, ctx: &ResolveContext<'_>) -> Vec<String> {
    let targets: Vec<String> = match import {
        RawImport::Module { specifier } => ecmascript::resolve(from, specifier, ctx)
            .into_iter()
            .collect(),
        RawImport::RustMod { .. } | RawImport::RustUse { .. } => {
            rust_lang::resolve(from, import, ctx.has_file)
                .into_iter()
                .collect()
        }
        RawImport::Python {
            level,
            module,
            names,
        } => python::resolve(from, *level, module, names, ctx.has_file),
    };
    targets
        .into_iter()
        .filter(|target| target != from)
        .collect()
}
