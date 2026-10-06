import Graph from "graphology";

import type { SnapshotDiff } from "./graph-diff";
import { baseName, directoryKey } from "./graph-paths";
import type { GraphEdgeData, GraphSnapshot, Language } from "./graph-types";
import { initialPosition, positionNear, type Point } from "./placement";

export interface NodeAttrs {
  x: number;
  y: number;
  size: number;
  label: string;
  language: Language;
  dirKey: string;
}

export interface EdgeAttrs {
  type: string;
}

export type CodeGraph = Graph<NodeAttrs, EdgeAttrs>;

export const EDGE_TYPE = "arrow";
const BASE_NODE_SIZE = 4;

interface Placement {
  graph: CodeGraph;
  stored: ReadonlyMap<string, Point>;
  neighbours: ReadonlyMap<string, readonly string[]>;
  fresh: boolean;
}

export function createCodeGraph(): CodeGraph {
  return new Graph<NodeAttrs, EdgeAttrs>({ type: "directed", multi: false, allowSelfLoops: false });
}

function neighbourIndex(edges: readonly GraphEdgeData[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const list = index.get(from);
    if (list === undefined) index.set(from, [to]);
    else list.push(to);
  };
  for (const edge of edges) {
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }
  return index;
}

function placeNode(placement: Placement, id: string): Point {
  const known = placement.stored.get(id);
  if (known !== undefined) return known;
  if (placement.fresh) return initialPosition(id);
  const placed = (placement.neighbours.get(id) ?? [])
    .filter((other) => placement.graph.hasNode(other))
    .map((other) => placement.graph.getNodeAttributes(other));
  return positionNear(id, placed);
}

function dropRemoved(graph: CodeGraph, diff: SnapshotDiff): void {
  for (const edge of diff.removedEdges) {
    if (graph.hasDirectedEdge(edge.source, edge.target)) graph.dropDirectedEdge(edge.source, edge.target);
  }
  for (const id of diff.removedNodes) {
    if (graph.hasNode(id)) graph.dropNode(id);
  }
}

function addEdges(graph: CodeGraph, edges: readonly GraphEdgeData[]): void {
  for (const { source, target } of edges) {
    const connectable = source !== target && graph.hasNode(source) && graph.hasNode(target);
    if (connectable && !graph.hasDirectedEdge(source, target)) {
      graph.addDirectedEdge(source, target, { type: EDGE_TYPE });
    }
  }
}

export function applyDiff(graph: CodeGraph, diff: SnapshotDiff, stored: ReadonlyMap<string, Point>): void {
  dropRemoved(graph, diff);
  const placement: Placement = {
    graph,
    stored,
    neighbours: neighbourIndex(diff.addedEdges),
    fresh: graph.order === 0,
  };
  for (const node of diff.addedNodes) {
    if (graph.hasNode(node.id)) continue;
    graph.addNode(node.id, {
      ...placeNode(placement, node.id),
      size: BASE_NODE_SIZE,
      label: baseName(node.id),
      language: node.language,
      dirKey: directoryKey(node.id),
    });
  }
  addEdges(graph, diff.addedEdges);
}

export function snapshotToGraph(snapshot: GraphSnapshot, stored: ReadonlyMap<string, Point>): CodeGraph {
  const graph = createCodeGraph();
  applyDiff(
    graph,
    { addedNodes: snapshot.nodes, removedNodes: [], addedEdges: snapshot.edges, removedEdges: [] },
    stored,
  );
  return graph;
}

export function readPositions(graph: CodeGraph): ReadonlyMap<string, Point> {
  const positions = new Map<string, Point>();
  graph.forEachNode((id, attributes) => {
    positions.set(id, { x: attributes.x, y: attributes.y });
  });
  return positions;
}
