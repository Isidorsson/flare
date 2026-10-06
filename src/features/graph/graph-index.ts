import { baseName as pathBaseName } from "@/shared/lib/path-name";

import {
  buildDirectoryTree,
  collectFiles,
  fileFolder,
  forEachDir,
  owningHub,
  selectHubFolders,
  type DirNode,
} from "./directory-tree";
import type { GraphSnapshot } from "./graph-types";
import { importanceOf, sizeScale, type SizeScale } from "./node-scale";
import { countRoles, dominantRole, roleOf, type Role, type RoleCounts } from "./roles";

/** Everything the view needs to know about a snapshot that is not a position: folders, roles, importance. */
export interface GraphIndex {
  readonly tree: DirNode;
  readonly hubs: ReadonlySet<string>;
  readonly scale: SizeScale;
  readonly importance: ReadonlyMap<string, number>;
  readonly roles: ReadonlyMap<string, Role>;
  readonly folderRoles: ReadonlyMap<string, Role>;
  readonly folders: ReadonlyMap<string, DirNode>;
  readonly roleCounts: RoleCounts;
  readonly rootLabel: string;
  /** For each file, the files that import it directly. */
  readonly importers: ReadonlyMap<string, readonly string[]>;
  /** For each file, the files it imports directly. */
  readonly imports: ReadonlyMap<string, readonly string[]>;
}

function importDegrees(snapshot: GraphSnapshot): Map<string, number> {
  const importance = new Map<string, number>(snapshot.nodes.map((node) => [node.id, 0]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const { source, target } of snapshot.edges) {
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
    outgoing.set(source, (outgoing.get(source) ?? 0) + 1);
  }
  for (const id of importance.keys()) {
    importance.set(id, importanceOf(incoming.get(id) ?? 0, outgoing.get(id) ?? 0));
  }
  return importance;
}

function adjacency(snapshot: GraphSnapshot): { importers: Map<string, string[]>; imports: Map<string, string[]> } {
  const importers = new Map<string, string[]>();
  const imports = new Map<string, string[]>();
  const link = (map: Map<string, string[]>, from: string, to: string) => {
    const list = map.get(from);
    if (list === undefined) map.set(from, [to]);
    else list.push(to);
  };
  for (const { source, target } of snapshot.edges) {
    if (source === target) continue;
    link(importers, target, source);
    link(imports, source, target);
  }
  return { importers, imports };
}

function folderRoleMap(tree: DirNode, roles: ReadonlyMap<string, Role>): Map<string, Role> {
  const result = new Map<string, Role>();
  forEachDir(tree, (dir) => {
    const subtree = collectFiles(dir).map((id) => roles.get(id) ?? "code");
    result.set(dir.path, dominantRole(subtree));
  });
  return result;
}

export function buildGraphIndex(snapshot: GraphSnapshot): GraphIndex {
  const ids = snapshot.nodes.map((node) => node.id);
  const tree = buildDirectoryTree(ids);
  const importance = importDegrees(snapshot);
  const roles = new Map<string, Role>(ids.map((id) => [id, roleOf(id)]));
  const folders = new Map<string, DirNode>();
  forEachDir(tree, (dir) => {
    folders.set(dir.path, dir);
  });
  const maxImportance = Math.max(0, ...importance.values());
  const { importers, imports } = adjacency(snapshot);
  return {
    tree,
    hubs: selectHubFolders(tree),
    scale: sizeScale(ids.length, maxImportance),
    importance,
    roles,
    folderRoles: folderRoleMap(tree, roles),
    folders,
    roleCounts: countRoles(roles.values()),
    rootLabel: pathBaseName(snapshot.root),
    importers,
    imports,
  };
}

const cache = new WeakMap<GraphSnapshot, GraphIndex>();

/** The index of a snapshot, built once however many views ask for it. */
export function graphIndexFor(snapshot: GraphSnapshot): GraphIndex {
  const known = cache.get(snapshot);
  if (known !== undefined) return known;
  const index = buildGraphIndex(snapshot);
  cache.set(snapshot, index);
  return index;
}

export function hubOfFile(index: GraphIndex, fileId: string): string {
  return owningHub(index.hubs, fileFolder(fileId));
}

/** Files that belong to a hub without belonging to a smaller hub beneath it. */
export function hubOwnFiles(index: GraphIndex, hub: string): string[] {
  const dir = index.folders.get(hub);
  if (dir === undefined) return [];
  const own: string[] = [];
  const visit = (node: DirNode) => {
    own.push(...node.files);
    for (const child of node.dirs) {
      if (!index.hubs.has(child.path)) visit(child);
    }
  };
  visit(dir);
  return own;
}
