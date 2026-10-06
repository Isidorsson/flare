use std::collections::{BTreeMap, BTreeSet, HashSet};

use super::model::BlastNode;

pub type Adjacency = BTreeMap<String, BTreeSet<String>>;

pub fn dependents(edges: &Adjacency, origin: &str) -> Vec<BlastNode> {
    let reverse = reverse_adjacency(edges);
    let mut seen: HashSet<&str> = HashSet::from([origin]);
    let mut frontier: Vec<&str> = vec![origin];
    let mut reached = Vec::new();
    let mut depth = 0;
    while !frontier.is_empty() {
        depth += 1;
        let mut next = Vec::new();
        for node in frontier {
            for dependent in reverse.get(node).into_iter().flatten() {
                if seen.insert(dependent) {
                    next.push(*dependent);
                    reached.push(BlastNode {
                        id: (*dependent).to_string(),
                        depth,
                    });
                }
            }
        }
        frontier = next;
    }
    reached.sort_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.id.cmp(&b.id)));
    reached
}

fn reverse_adjacency(edges: &Adjacency) -> BTreeMap<&str, Vec<&str>> {
    let mut reverse: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (source, targets) in edges {
        for target in targets {
            reverse
                .entry(target.as_str())
                .or_default()
                .push(source.as_str());
        }
    }
    reverse
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph(edges: &[(&str, &str)]) -> Adjacency {
        let mut adjacency = Adjacency::new();
        for (source, target) in edges {
            adjacency
                .entry((*source).to_string())
                .or_default()
                .insert((*target).to_string());
        }
        adjacency
    }

    fn depths(nodes: &[BlastNode]) -> Vec<(&str, u32)> {
        nodes
            .iter()
            .map(|node| (node.id.as_str(), node.depth))
            .collect()
    }

    #[test]
    fn walks_importers_breadth_first_and_reports_depth() {
        let edges = graph(&[("a", "b"), ("b", "c"), ("d", "c"), ("e", "d")]);
        let nodes = dependents(&edges, "c");
        assert_eq!(depths(&nodes), [("b", 1), ("d", 1), ("a", 2), ("e", 2)]);
    }

    #[test]
    fn uses_the_shortest_path_in_diamonds() {
        let edges = graph(&[
            ("top", "left"),
            ("top", "right"),
            ("left", "base"),
            ("right", "base"),
            ("top", "base"),
        ]);
        let nodes = dependents(&edges, "base");
        assert_eq!(depths(&nodes), [("left", 1), ("right", 1), ("top", 1)]);
    }

    #[test]
    fn terminates_on_cycles_and_excludes_the_origin() {
        let edges = graph(&[("a", "b"), ("b", "c"), ("c", "a"), ("c", "c")]);
        let nodes = dependents(&edges, "a");
        assert_eq!(depths(&nodes), [("c", 1), ("b", 2)]);
    }

    #[test]
    fn files_nobody_imports_have_an_empty_radius() {
        let edges = graph(&[("a", "b")]);
        assert!(dependents(&edges, "a").is_empty());
        assert!(dependents(&edges, "unknown").is_empty());
    }

    #[test]
    fn follows_long_chains_to_their_full_depth() {
        let names: Vec<String> = (0..200).map(|index| format!("n{index}")).collect();
        let mut edges = Adjacency::new();
        for pair in names.windows(2) {
            edges
                .entry(pair[0].clone())
                .or_default()
                .insert(pair[1].clone());
        }
        let nodes = dependents(&edges, "n199");
        assert_eq!(nodes.len(), 199);
        assert_eq!(nodes.last().map(|node| node.depth), Some(199));
    }
}
