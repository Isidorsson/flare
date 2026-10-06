import {
  fileFolder,
  folderId,
  folderName,
  folderPath,
  forEachDir,
  isFolderId,
  owningHub,
  parentFolder,
} from "./directory-tree";
import { packDirectories, type Seeds } from "./folder-pack";
import type { SnapshotDiff } from "./graph-diff";
import { graphIndexFor, hubOfFile, type GraphIndex } from "./graph-index";
import {
  createCodeGraph,
  IMPORT_EDGE_TYPE,
  TREE_EDGE_TYPE,
  type CodeGraph,
  type EdgeKind,
  type NodeAttrs,
} from "./graph-model";
import { baseName } from "./graph-paths";
import type { GraphEdgeData, GraphNodeData, GraphSnapshot } from "./graph-types";
import { fileSize, hubSize } from "./node-scale";
import { jitterAround, placeNear, type Point } from "./placement";
import { buildAffinity } from "./sibling-layout";

const ORIGIN: Point = { x: 0, y: 0 };

interface SyncContext {
  readonly graph: CodeGraph;
  readonly index: GraphIndex;
  readonly stored: ReadonlyMap<string, Point>;
  readonly seeds: Seeds | null;
}

function dropRemoved(graph: CodeGraph, diff: SnapshotDiff): void {
  for (const edge of diff.removedEdges) {
    if (graph.hasDirectedEdge(edge.source, edge.target)) graph.dropDirectedEdge(edge.source, edge.target);
  }
  for (const id of diff.removedNodes) {
    if (graph.hasNode(id)) graph.dropNode(id);
  }
}

function dropStaleFolders(context: SyncContext): void {
  const stale: string[] = [];
  context.graph.forEachNode((id) => {
    if (isFolderId(id) && !context.index.folders.has(folderPath(id))) stale.push(id);
  });
  for (const id of stale) context.graph.dropNode(id);
}

function neighbourPoints(graph: CodeGraph, id: string, edges: readonly GraphEdgeData[]): Point[] {
  const points: Point[] = [];
  for (const edge of edges) {
    const other = edge.source === id ? edge.target : edge.target === id ? edge.source : null;
    if (other !== null && graph.hasNode(other)) points.push(graph.getNodeAttributes(other));
  }
  return points;
}

function folderAnchor(graph: CodeGraph, path: string): Point | null {
  let current: string | null = path;
  while (current !== null) {
    const id = folderId(current);
    if (graph.hasNode(id)) return graph.getNodeAttributes(id);
    current = parentFolder(current);
  }
  return null;
}

function filePosition(context: SyncContext, node: GraphNodeData, edges: readonly GraphEdgeData[]): Point {
  const { graph, stored, seeds } = context;
  const known = stored.get(node.id) ?? seeds?.files.get(node.id);
  if (known !== undefined) return known;
  const byImports = placeNear(node.id, neighbourPoints(graph, node.id, edges));
  if (byImports !== null) return byImports;
  const hub = folderAnchor(graph, fileFolder(node.id));
  return jitterAround(node.id, hub ?? ORIGIN);
}

function folderPosition(context: SyncContext, path: string): Point {
  const { graph, stored, seeds } = context;
  const known = stored.get(folderId(path)) ?? seeds?.folders.get(path);
  if (known !== undefined) return known;
  const parent = parentFolder(path);
  const anchor = parent === null ? null : folderAnchor(graph, parent);
  return jitterAround(folderId(path), anchor ?? ORIGIN);
}

function baseAttributes(point: Point): Pick<NodeAttrs, "x" | "y" | "importance" | "files"> {
  return { x: point.x, y: point.y, importance: 0, files: 0 };
}

function addFolders(context: SyncContext): void {
  const { graph, index } = context;
  forEachDir(index.tree, (dir) => {
    const id = folderId(dir.path);
    if (graph.hasNode(id)) return;
    graph.addNode(id, {
      ...baseAttributes(folderPosition(context, dir.path)),
      size: hubSize(dir.size),
      label: dir.path === "" ? index.rootLabel : folderName(dir.path),
      kind: "folder",
      language: null,
      role: "code",
      hub: dir.path,
      folder: dir.path,
    });
  });
}

function addFiles(context: SyncContext, diff: SnapshotDiff): void {
  const { graph } = context;
  for (const node of diff.addedNodes) {
    if (isFolderId(node.id)) throw new Error(`file id "${node.id}" collides with the folder id namespace`);
    if (graph.hasNode(node.id)) continue;
    graph.addNode(node.id, {
      ...baseAttributes(filePosition(context, node, diff.addedEdges)),
      size: context.index.scale.min,
      label: baseName(node.id),
      kind: "file",
      language: node.language,
      role: "code",
      hub: "",
      folder: fileFolder(node.id),
    });
  }
}

function addEdge(graph: CodeGraph, source: string, target: string, kind: EdgeKind): void {
  if (source === target || !graph.hasNode(source) || !graph.hasNode(target)) return;
  if (graph.hasDirectedEdge(source, target)) return;
  graph.addDirectedEdge(source, target, { type: kind === "import" ? IMPORT_EDGE_TYPE : TREE_EDGE_TYPE, kind });
}

function addEdges(context: SyncContext, diff: SnapshotDiff): void {
  const { graph, index } = context;
  for (const { source, target } of diff.addedEdges) addEdge(graph, source, target, "import");
  forEachDir(index.tree, (dir) => {
    const parent = parentFolder(dir.path);
    if (parent !== null) addEdge(graph, folderId(parent), folderId(dir.path), "tree");
    for (const file of dir.files) addEdge(graph, folderId(dir.path), file, "tree");
  });
}

function applyDerived(context: SyncContext): void {
  const { graph, index } = context;
  graph.updateEachNodeAttributes((id, attributes) => {
    if (isFolderId(id)) {
      const path = attributes.folder;
      const files = index.folders.get(path)?.size ?? 0;
      return {
        ...attributes,
        files,
        size: hubSize(files),
        role: index.folderRoles.get(path) ?? "code",
        hub: owningHub(index.hubs, path),
      };
    }
    const importance = index.importance.get(id) ?? 0;
    return {
      ...attributes,
      importance,
      size: fileSize(importance, index.scale),
      role: index.roles.get(id) ?? "code",
      hub: hubOfFile(index, id),
    };
  });
}

/** Brings the graph in line with a snapshot: files, imports, the folder hierarchy above them, and derived display data. */
export function syncGraph(
  graph: CodeGraph,
  snapshot: GraphSnapshot,
  diff: SnapshotDiff,
  stored: ReadonlyMap<string, Point>,
): GraphIndex {
  const index = graphIndexFor(snapshot);
  const seeds = graph.order === 0 ? packDirectories(index.tree, buildAffinity(snapshot.edges)) : null;
  const context: SyncContext = { graph, index, stored, seeds };
  dropRemoved(graph, diff);
  dropStaleFolders(context);
  addFolders(context);
  addFiles(context, diff);
  addEdges(context, diff);
  applyDerived(context);
  return index;
}

export function snapshotToGraph(snapshot: GraphSnapshot, stored: ReadonlyMap<string, Point>): CodeGraph {
  const graph = createCodeGraph();
  const diff: SnapshotDiff = { addedNodes: snapshot.nodes, removedNodes: [], addedEdges: snapshot.edges, removedEdges: [] };
  syncGraph(graph, snapshot, diff, stored);
  return graph;
}
