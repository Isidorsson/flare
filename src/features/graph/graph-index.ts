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
  /** What each hub is called on screen: its folder name, with a parent added where two hubs would read the same. */
  readonly hubNames: ReadonlyMap<string, string>;
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

function hubNameMap(hubs: ReadonlySet<string>, rootLabel: string): Map<string, string> {
  const lastSegments = (path: string, count: number) => path.split("/").slice(-count).join("/");
  const counts = new Map<string, number>();
  for (const hub of hubs) counts.set(lastSegments(hub, 1), (counts.get(lastSegments(hub, 1)) ?? 0) + 1);
  const names = new Map<string, string>();
  for (const hub of hubs) {
    const clash = (counts.get(lastSegments(hub, 1)) ?? 0) > 1;
    names.set(hub, hub === "" ? rootLabel : lastSegments(hub, clash ? 2 : 1));
  }
  return names;
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
  const hubs = selectHubFolders(tree);
  const rootLabel = pathBaseName(snapshot.root);
  return {
    tree,
    hubs,
    scale: sizeScale(ids.length, maxImportance),
    importance,
    roles,
    folderRoles: folderRoleMap(tree, roles),
    folders,
    roleCounts: countRoles(roles.values()),
    rootLabel,
    hubNames: hubNameMap(hubs, rootLabel),
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
