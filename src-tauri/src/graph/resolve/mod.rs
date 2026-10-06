mod c_family;
mod config;
mod dart;
mod declared;
mod dotnet;
mod ecmascript;
mod go;
mod jvm;
mod lua;
mod php;
mod python;
mod ruby;
mod rust_lang;
mod shell;
mod stylesheet;
pub mod tsconfig;
pub mod workspace_packages;
mod zig;

use super::extract::RawImport;
use super::lang::SourceKind;

pub use config::{is_resolution_config, ProjectConfig};
pub use declared::{Declarations, DeclaredFile};

pub struct ResolveContext<'a> {
    pub has_file: &'a dyn Fn(&str) -> bool,
    pub config: &'a ProjectConfig,
    pub declared: &'a Declarations,
}

pub fn resolve_import(
    from: &str,
    kind: SourceKind,
    import: &RawImport,
    ctx: &ResolveContext<'_>,
) -> Vec<String> {
    let targets = match import {
        RawImport::Module { specifier } => option_vec(ecmascript::resolve(from, specifier, ctx)),
        RawImport::RustMod { .. } | RawImport::RustUse { .. } => {
            option_vec(rust_lang::resolve(from, import, ctx.has_file))
        }
        RawImport::Python {
            level,
            module,
            names,
        } => python::resolve(from, *level, module, names, ctx.has_file),
        RawImport::LuaModule { .. } | RawImport::RobloxPath { .. } => {
            lua::resolve(from, kind, import, ctx.has_file)
        }
        RawImport::GoImport { path } => go::resolve(path, ctx),
        RawImport::Include { path } => option_vec(c_family::resolve(from, path, ctx.has_file)),
        RawImport::CSharpUsing {
            namespace,
            may_be_type,
        } => dotnet::resolve(namespace, *may_be_type, ctx.declared),
        RawImport::JvmImport { name, wildcard } => {
            jvm::resolve(from, name, *wildcard, ctx.declared, ctx.has_file)
        }
        RawImport::RubyRequire { path, relative } => {
            option_vec(ruby::resolve(from, path, *relative, ctx.has_file))
        }
        RawImport::PhpInclude { path } => {
            option_vec(php::resolve_include(from, path, ctx.has_file))
        }
        RawImport::PhpUse { name } => option_vec(php::resolve_use(name, ctx)),
        RawImport::DartImport { uri } => option_vec(dart::resolve(from, uri, ctx)),
        RawImport::ZigImport { path } => option_vec(zig::resolve(from, path, ctx.has_file)),
        RawImport::ShellSource { path } => option_vec(shell::resolve(from, path, ctx.has_file)),
        RawImport::StyleImport { path } => {
            option_vec(stylesheet::resolve(from, kind, path, ctx.has_file))
        }
    };
    targets
        .into_iter()
        .filter(|target| target != from)
        .collect()
}

fn option_vec(target: Option<String>) -> Vec<String> {
    target.into_iter().collect()
}
