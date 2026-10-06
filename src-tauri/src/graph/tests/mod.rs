mod blast_radius;
mod ecmascript;
mod incremental;
mod python;
mod rust_lang;
mod workspace;

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::indexer::Indexer;

pub struct Fixture {
    dir: TempDir,
}

impl Fixture {
    pub fn new(files: &[(&str, &str)]) -> Self {
        let dir = tempfile::Builder::new()
            .prefix("flare-graph-")
            .tempdir()
            .unwrap();
        let fixture = Self { dir };
        for (path, content) in files {
            fixture.write(path, content);
        }
        fixture
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn absolute(&self, rel: &str) -> String {
        let canonical = fs::canonicalize(self.path()).unwrap();
        canonical.join(rel).to_string_lossy().into_owned()
    }

    pub fn write(&self, rel: &str, content: &str) {
        let full: PathBuf = self.path().join(rel);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }

    pub fn delete(&self, rel: &str) {
        let full = self.path().join(rel);
        if full.is_dir() {
            fs::remove_dir_all(full).unwrap();
        } else {
            fs::remove_file(full).unwrap();
        }
    }

    pub fn index(&self) -> Indexer {
        Indexer::build(self.path()).unwrap()
    }
}

pub fn edges(indexer: &Indexer) -> Vec<(String, String)> {
    indexer
        .snapshot()
        .edges
        .into_iter()
        .map(|edge| (edge.source, edge.target))
        .collect()
}

pub fn imports_of(indexer: &Indexer, source: &str) -> Vec<String> {
    edges(indexer)
        .into_iter()
        .filter(|(from, _)| from == source)
        .map(|(_, to)| to)
        .collect()
}

pub fn node_ids(indexer: &Indexer) -> Vec<String> {
    indexer
        .snapshot()
        .nodes
        .into_iter()
        .map(|node| node.id)
        .collect()
}

pub fn pair(source: &str, target: &str) -> (String, String) {
    (source.to_string(), target.to_string())
}
