import type { GraphEdgeData, GraphNodeData, GraphSnapshot } from "./graph-types";

export interface SnapshotDiff {
  readonly addedNodes: readonly GraphNodeData[];
  readonly removedNodes: readonly string[];
  readonly addedEdges: readonly GraphEdgeData[];
  readonly removedEdges: readonly GraphEdgeData[];
}

export function edgeKey(edge: GraphEdgeData): string {
  return `${edge.source}\u0000${edge.target}`;
}

export function isEmptyDiff(diff: SnapshotDiff): boolean {
  return (
    diff.addedNodes.length === 0 &&
    diff.removedNodes.length === 0 &&
    diff.addedEdges.length === 0 &&
    diff.removedEdges.length === 0
  );
}

export function diffSnapshots(previous: GraphSnapshot | null, next: GraphSnapshot): SnapshotDiff {
  const previousNodes = new Map((previous?.nodes ?? []).map((node) => [node.id, node]));
  const nextNodeIds = new Set(next.nodes.map((node) => node.id));
  const previousEdges = new Map((previous?.edges ?? []).map((edge) => [edgeKey(edge), edge]));
  const nextEdges = new Map(next.edges.map((edge) => [edgeKey(edge), edge]));
  return {
    addedNodes: next.nodes.filter((node) => !previousNodes.has(node.id)),
    removedNodes: [...previousNodes.keys()].filter((id) => !nextNodeIds.has(id)),
    addedEdges: next.edges.filter((edge) => !previousEdges.has(edgeKey(edge))),
    removedEdges: [...previousEdges.entries()]
      .filter(([key]) => !nextEdges.has(key))
      .map(([, edge]) => edge),
  };
}
