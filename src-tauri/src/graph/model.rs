use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    TypeScript,
    JavaScript,
    Rust,
    Python,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub language: Language,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GraphSnapshot {
    pub root: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BlastNode {
    pub id: String,
    pub depth: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BlastRadius {
    pub origin: String,
    pub nodes: Vec<BlastNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Change {
    Unchanged,
    Added,
    Updated,
    Removed,
    Rebuilt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn languages_and_changes_serialise_lowercase() {
        assert_eq!(
            serde_json::to_string(&Language::TypeScript).unwrap(),
            "\"typescript\""
        );
        assert_eq!(
            serde_json::to_string(&Change::Rebuilt).unwrap(),
            "\"rebuilt\""
        );
    }

    #[test]
    fn snapshot_serialises_with_the_documented_shape() {
        let snapshot = GraphSnapshot {
            root: "C:/app".into(),
            nodes: vec![GraphNode {
                id: "src/a.rs".into(),
                language: Language::Rust,
            }],
            edges: vec![GraphEdge {
                source: "src/a.rs".into(),
                target: "src/b.rs".into(),
            }],
            warnings: vec![],
        };
        let value = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(value["nodes"][0]["language"], "rust");
        assert_eq!(value["edges"][0]["target"], "src/b.rs");
        assert_eq!(value["warnings"], serde_json::json!([]));
    }
}
