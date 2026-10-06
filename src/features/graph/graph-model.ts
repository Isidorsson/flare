import Graph from "graphology";

import type { NodeStyle } from "./appearance";
import type { Language } from "./graph-types";
import type { Point } from "./placement";
import type { Role } from "./roles";

export type NodeKind = "file" | "folder";
export type EdgeKind = "import" | "tree";

export interface NodeAttrs {
  x: number;
  y: number;
  size: number;
  label: string;
  kind: NodeKind;
  language: Language | null;
  role: Role;
  /** The nearest labelled folder at or above this node; a hub's own path for the hub itself. */
  hub: string;
  /** For a file the folder it sits in, for a folder its own path. */
  folder: string;
  /** Files below a folder; zero for files. */
  files: number;
  importance: number;
}

export interface EdgeAttrs {
  type: string;
  kind: EdgeKind;
}

export type CodeGraph = Graph<NodeAttrs, EdgeAttrs>;

export type NodeDisplay = NodeAttrs & NodeStyle;

/** Sigma renders whatever a node reducer returns, so the position has to travel with the style. */
export function displayNode(data: NodeAttrs, style: NodeStyle): NodeDisplay {
  return { ...data, ...style };
}

export const IMPORT_EDGE_TYPE = "arrow";
export const TREE_EDGE_TYPE = "line";

export function createCodeGraph(): CodeGraph {
  return new Graph<NodeAttrs, EdgeAttrs>({ type: "directed", multi: false, allowSelfLoops: false });
}

export function readPositions(graph: CodeGraph): ReadonlyMap<string, Point> {
  const positions = new Map<string, Point>();
  graph.forEachNode((id, attributes) => {
    positions.set(id, { x: attributes.x, y: attributes.y });
  });
  return positions;
}
