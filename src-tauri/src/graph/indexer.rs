use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use rayon::prelude::*;

use super::blast::{self, Adjacency};
use super::error::GraphError;
use super::extract::{Declared, Extractor, RawImport};
use super::lang::SourceKind;
use super::model::{BlastRadius, Change, GraphEdge, GraphNode, GraphSnapshot};
use super::paths;
use super::resolve::{
    is_resolution_config, resolve_import, Declarations, DeclaredFile, ProjectConfig, ResolveContext,
};
use super::walk::{self, IgnoreRules, SourceFile, GITIGNORE_FILE};

pub const MAX_SOURCE_BYTES: u64 = 1024 * 1024;
const MAX_WARNINGS: usize = 50;

#[derive(Debug, Clone)]
struct FileEntry {
    kind: SourceKind,
    imports: Vec<RawImport>,
    declared: Vec<Declared>,
}

type Files = BTreeMap<String, FileEntry>;

pub struct Indexer {
    root: PathBuf,
    root_label: String,
    given_root: Option<String>,
    files: Files,
    config_files: BTreeSet<String>,
    config: ProjectConfig,
    declared: Declarations,
    edges: Adjacency,
    ignore: IgnoreRules,
    build_warnings: Vec<String>,
}

impl Indexer {
    pub fn build(root: &Path) -> Result<Self, GraphError> {
        let (root_path, root_label) = canonical_root(root)?;
        let scan = walk::scan(&root_path);
        let mut build_warnings = scan.warnings;
        let parsed: Vec<Result<(String, FileEntry), GraphError>> = scan
            .sources
            .par_iter()
            .map_init(Extractor::new, |extractor, file| {
                parse_file(&root_path, file, extractor).map(|entry| (file.path.clone(), entry))
            })
            .collect();
        let mut files = Files::new();
        for result in parsed {
            match result {
                Ok((path, entry)) => {
                    files.insert(path, entry);
                }
                Err(error) => build_warnings.push(error.to_string()),
            }
        }
        let config_files: BTreeSet<String> = scan.configs.into_iter().collect();
        let config = ProjectConfig::load(&root_path, &config_files);
        let declared = build_declarations(&files);
        let edges = compute_edges(&files, &config, &declared);
        let given = paths::normalize_separators(&root.to_string_lossy());
        Ok(Self {
            ignore: IgnoreRules::new(&root_path),
            root: root_path,
            root_label,
            given_root: paths::is_absolute(&given).then_some(given),
            files,
            config_files,
            config,
            declared,
            edges,
            build_warnings,
        })
    }

    pub fn snapshot(&self) -> GraphSnapshot {
        GraphSnapshot {
            root: self.root_label.clone(),
            nodes: self
                .files
                .iter()
                .map(|(id, entry)| GraphNode {
                    id: id.clone(),
                    language: entry.kind.language(),
                })
                .collect(),
            edges: self
                .edges
                .iter()
                .flat_map(|(source, targets)| {
                    targets.iter().map(|target| GraphEdge {
                        source: source.clone(),
                        target: target.clone(),
                    })
                })
                .collect(),
            warnings: self.warnings(),
        }
    }

    pub fn blast_radius(&self, path: &str) -> Result<BlastRadius, GraphError> {
        let key = self.known_key(path)?;
        Ok(BlastRadius {
            nodes: blast::dependents(&self.edges, &key),
            origin: key,
        })
    }

    pub fn update_file(&mut self, path: &str) -> Result<Change, GraphError> {
        let rel = self.relative(path)?;
        if paths::file_name(&rel) == GITIGNORE_FILE {
            return self.rebuild().map(|()| Change::Rebuilt);
        }
        let kind = SourceKind::from_path(&rel);
        let is_config = is_resolution_config(&rel);
        if (kind.is_none() && !is_config) || self.ignore.is_ignored(&rel) {
            return Ok(Change::Unchanged);
        }
        match self.root.join(&rel).try_exists() {
            Ok(true) => {}
            Ok(false) => return self.remove_file(&rel),
            Err(error) => return Err(GraphError::io(rel, &error)),
        }
        match kind {
            Some(kind) => self.update_source(rel, kind),
            None => Ok(self.update_config(rel)),
        }
    }

    pub fn remove_file(&mut self, path: &str) -> Result<Change, GraphError> {
        let rel = self.canonical_key(self.relative(path)?);
        if paths::file_name(&rel) == GITIGNORE_FILE {
            return self.rebuild().map(|()| Change::Rebuilt);
        }
        let folder = format!("{rel}/");
        let before = self.files.len();
        self.files.remove(&rel);
        self.files.retain(|known, _| !known.starts_with(&folder));
        let removed_source = self.files.len() != before;
        let configs_before = self.config_files.len();
        self.config_files
            .retain(|known| *known != rel && !known.starts_with(&folder));
        if self.config_files.len() != configs_before {
            self.reload_config();
        }
        if removed_source || self.config_files.len() != configs_before {
            self.recompute_edges();
        }
        Ok(if removed_source {
            Change::Removed
        } else {
            Change::Unchanged
        })
    }

    fn update_source(&mut self, rel: String, kind: SourceKind) -> Result<Change, GraphError> {
        let key = self.canonical_key(rel);
        let extraction = Extractor::new().extract(kind, &key, &read_source(&self.root, &key)?)?;
        let declared_changed = self
            .files
            .get(&key)
            .is_some_and(|known| known.declared != extraction.declared);
        let entry = FileEntry {
            kind,
            imports: extraction.imports,
            declared: extraction.declared,
        };
        let existed = self.files.insert(key.clone(), entry).is_some();
        if !existed {
            self.recompute_edges();
            return Ok(Change::Added);
        }
        if declared_changed {
            return Ok(if self.recompute_edges() {
                Change::Updated
            } else {
                Change::Unchanged
            });
        }
        let targets = targets_of(&key, &self.files, &self.config, &self.declared);
        let before = self.edges.get(&key);
        if (before.is_none() && targets.is_empty()) || before == Some(&targets) {
            return Ok(Change::Unchanged);
        }
        if targets.is_empty() {
            self.edges.remove(&key);
        } else {
            self.edges.insert(key, targets);
        }
        Ok(Change::Updated)
    }

    fn update_config(&mut self, rel: String) -> Change {
        self.config_files.insert(rel);
        self.reload_config();
        if self.recompute_edges() {
            Change::Updated
        } else {
            Change::Unchanged
        }
    }

    fn rebuild(&mut self) -> Result<(), GraphError> {
        let source = self
            .given_root
            .clone()
            .unwrap_or_else(|| self.root_label.clone());
        *self = Self::build(Path::new(&source))?;
        Ok(())
    }

    fn reload_config(&mut self) {
        self.config = ProjectConfig::load(&self.root, &self.config_files);
    }

    fn recompute_edges(&mut self) -> bool {
        self.declared = build_declarations(&self.files);
        let edges = compute_edges(&self.files, &self.config, &self.declared);
        let changed = edges != self.edges;
        self.edges = edges;
        changed
    }

    fn relative(&self, path: &str) -> Result<String, GraphError> {
        let as_given = self.given_root.as_deref();
        paths::strip_root(&self.root_label, path)
            .or_else(|| as_given.and_then(|root| paths::strip_root(root, path)))
            .ok_or_else(|| GraphError::OutsideWorkspace(path.to_string()))
    }

    fn canonical_key(&self, rel: String) -> String {
        if !cfg!(windows) || self.files.contains_key(&rel) {
            return rel;
        }
        self.files
            .keys()
            .find(|known| known.eq_ignore_ascii_case(&rel))
            .cloned()
            .unwrap_or(rel)
    }

    fn known_key(&self, path: &str) -> Result<String, GraphError> {
        let key = self.canonical_key(self.relative(path)?);
        if self.files.contains_key(&key) {
            Ok(key)
        } else {
            Err(GraphError::UnknownFile(path.to_string()))
        }
    }

    fn warnings(&self) -> Vec<String> {
        let all: Vec<&String> = self
            .build_warnings
            .iter()
            .chain(&self.config.warnings)
            .chain(self.ignore.warnings())
            .collect();
        let mut shown: Vec<String> = all
            .iter()
            .take(MAX_WARNINGS)
            .map(|warning| (*warning).clone())
            .collect();
        if all.len() > MAX_WARNINGS {
            shown.push(format!("and {} more warnings", all.len() - MAX_WARNINGS));
        }
        shown
    }
}

fn canonical_root(root: &Path) -> Result<(PathBuf, String), GraphError> {
    let canonical = fs::canonicalize(root)
        .map_err(|error| GraphError::io(root.display().to_string(), &error))?;
    if !canonical.is_dir() {
        return Err(GraphError::InvalidRoot(root.display().to_string()));
    }
    let label = paths::normalize_separators(&canonical.to_string_lossy());
    Ok((PathBuf::from(&label), label))
}

fn read_source(root: &Path, rel: &str) -> Result<Vec<u8>, GraphError> {
    let full = root.join(rel);
    let metadata = fs::metadata(&full).map_err(|error| GraphError::io(rel, &error))?;
    if metadata.len() > MAX_SOURCE_BYTES {
        return Err(GraphError::Io {
            path: rel.to_string(),
            message: format!("larger than the {MAX_SOURCE_BYTES} byte indexing limit"),
        });
    }
    fs::read(&full).map_err(|error| GraphError::io(rel, &error))
}

fn parse_file(
    root: &Path,
    file: &SourceFile,
    extractor: &mut Extractor,
) -> Result<FileEntry, GraphError> {
    let source = read_source(root, &file.path)?;
    let extraction = extractor.extract(file.kind, &file.path, &source)?;
    Ok(FileEntry {
        kind: file.kind,
        imports: extraction.imports,
        declared: extraction.declared,
    })
}

fn build_declarations(files: &Files) -> Declarations {
    Declarations::build(files.iter().map(|(path, entry)| DeclaredFile {
        path,
        kind: entry.kind,
        declared: &entry.declared,
    }))
}

fn targets_of(
    path: &str,
    files: &Files,
    config: &ProjectConfig,
    declared: &Declarations,
) -> BTreeSet<String> {
    let Some(entry) = files.get(path) else {
        return BTreeSet::new();
    };
    let has_file = |candidate: &str| files.contains_key(candidate);
    let ctx = ResolveContext {
        has_file: &has_file,
        config,
        declared,
    };
    entry
        .imports
        .iter()
        .flat_map(|import| resolve_import(path, entry.kind, import, &ctx))
        .collect()
}

fn compute_edges(files: &Files, config: &ProjectConfig, declared: &Declarations) -> Adjacency {
    files
        .par_iter()
        .filter_map(|(path, _)| {
            let targets = targets_of(path, files, config, declared);
            (!targets.is_empty()).then(|| (path.clone(), targets))
        })
        .collect()
}
