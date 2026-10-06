/** Folder nodes live in the same graph as files, so their ids carry a prefix no file path can have. */
export const FOLDER_PREFIX = "\u0000folder:";

export function folderId(path: string): string {
  return `${FOLDER_PREFIX}${path}`;
}

export function isFolderId(id: string): boolean {
  return id.startsWith(FOLDER_PREFIX);
}

export function folderPath(id: string): string {
  if (!isFolderId(id)) throw new Error(`"${id}" is not a folder id`);
  return id.slice(FOLDER_PREFIX.length);
}

/** The folder a file sits in; the project root is the empty path. */
export function fileFolder(fileId: string): string {
  return fileId.slice(0, Math.max(fileId.lastIndexOf("/"), 0));
}

/** The folder containing a folder, or null for the root. */
export function parentFolder(path: string): string | null {
  if (path === "") return null;
  return path.slice(0, Math.max(path.lastIndexOf("/"), 0));
}

export function folderName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export interface DirNode {
  readonly path: string;
  readonly name: string;
  readonly files: readonly string[];
  readonly dirs: readonly DirNode[];
  /** Files in this folder and everything below it. */
  readonly size: number;
}

interface Builder {
  path: string;
  files: string[];
  dirs: Map<string, Builder>;
}

function createBuilder(path: string): Builder {
  return { path, files: [], dirs: new Map() };
}

function descend(root: Builder, folder: string): Builder {
  let current = root;
  let path = "";
  for (const segment of folder.split("/")) {
    if (segment === "") continue;
    path = path === "" ? segment : `${path}/${segment}`;
    let next = current.dirs.get(segment);
    if (next === undefined) {
      next = createBuilder(path);
      current.dirs.set(segment, next);
    }
    current = next;
  }
  return current;
}

function freeze(builder: Builder): DirNode {
  const dirs = [...builder.dirs.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, child]) => freeze(child));
  const files = [...builder.files].sort();
  return {
    path: builder.path,
    name: folderName(builder.path),
    files,
    dirs,
    size: files.length + dirs.reduce((total, dir) => total + dir.size, 0),
  };
}

export function buildDirectoryTree(fileIds: readonly string[]): DirNode {
  const root = createBuilder("");
  for (const id of fileIds) descend(root, fileFolder(id)).files.push(id);
  return freeze(root);
}

export function forEachDir(tree: DirNode, visit: (dir: DirNode) => void): void {
  visit(tree);
  for (const dir of tree.dirs) forEachDir(dir, visit);
}

export function collectFiles(dir: DirNode): string[] {
  return [...dir.files, ...dir.dirs.flatMap(collectFiles)];
}

export const MAX_OVERVIEW_HUBS = 24;

/**
 * Folders that get their own labelled hub in the overview: the root plus the biggest folders, as many as fit the cap.
 * Because a folder is never smaller than its children, the set always includes every ancestor of a member.
 */
export function selectHubFolders(tree: DirNode, cap: number = MAX_OVERVIEW_HUBS): ReadonlySet<string> {
  const sizes: { path: string; size: number }[] = [];
  forEachDir(tree, (dir) => {
    if (dir.path !== "" && dir.size > 0) sizes.push({ path: dir.path, size: dir.size });
  });
  sizes.sort((a, b) => b.size - a.size);
  const overflow = sizes[cap];
  const threshold = overflow === undefined ? 1 : overflow.size + 1;
  const hubs = new Set<string>([""]);
  for (const entry of sizes) {
    if (entry.size >= threshold) hubs.add(entry.path);
  }
  return hubs;
}

/** The nearest hub at or above a folder; the root always is one. */
export function owningHub(hubs: ReadonlySet<string>, path: string): string {
  let current: string | null = path;
  while (current !== null) {
    if (hubs.has(current)) return current;
    current = parentFolder(current);
  }
  return "";
}
