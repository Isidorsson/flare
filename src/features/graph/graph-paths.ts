export const DIRECTORY_COLOR_DEPTH = 3;

const VERBATIM_PREFIX = "//?/";

function normalizeSeparators(path: string): string {
  const unified = path.replaceAll("\\", "/");
  return unified.startsWith(VERBATIM_PREFIX) ? unified.slice(VERBATIM_PREFIX.length) : unified;
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:/.test(path);
}

function cleanRelative(path: string): string | null {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) return null;
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

export function toGraphPath(root: string, path: string): string | null {
  const normalized = normalizeSeparators(path);
  if (!isAbsolute(normalized)) return cleanRelative(normalized);
  const base = normalizeSeparators(root).replace(/\/+$/, "");
  if (normalized.slice(0, base.length).toLowerCase() !== base.toLowerCase()) return null;
  const rest = normalized.slice(base.length);
  if (rest !== "" && !rest.startsWith("/")) return null;
  return cleanRelative(rest);
}

export function toAbsolutePath(root: string, id: string): string {
  return `${normalizeSeparators(root).replace(/\/+$/, "")}/${id}`;
}

export function baseName(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}

export function directoryKey(id: string): string {
  const directories = id.split("/").slice(0, -1);
  return directories.slice(0, DIRECTORY_COLOR_DEPTH).join("/");
}

export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface NodeResolver {
  resolve: (path: string) => string | null;
}

export function createNodeResolver(ids: Iterable<string>): NodeResolver {
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  for (const id of ids) {
    exact.add(id);
    folded.set(id.toLowerCase(), id);
  }
  return {
    resolve: (path) => (exact.has(path) ? path : (folded.get(path.toLowerCase()) ?? null)),
  };
}

/** The node id a tool path refers to: the indexed id when known, else the clean workspace-relative path. */
export function resolveGraphNode(root: string | null, resolver: NodeResolver | null, path: string): string | null {
  if (root === null) return null;
  const relative = toGraphPath(root, path);
  if (relative === null || relative === "") return null;
  return resolver?.resolve(relative) ?? relative;
}
