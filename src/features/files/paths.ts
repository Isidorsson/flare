const DRIVE_PREFIX = /^[A-Za-z]:\//;

export function isAbsolutePath(path: string): boolean {
  const slashed = path.replaceAll("\\", "/");
  return DRIVE_PREFIX.test(slashed) || slashed.startsWith("/");
}

function splitRoot(slashed: string): { prefix: string; rest: string } {
  const drive = DRIVE_PREFIX.exec(slashed);
  if (drive) return { prefix: `${slashed.slice(0, 1).toUpperCase()}:/`, rest: slashed.slice(3) };
  if (slashed.startsWith("//")) return { prefix: "//", rest: slashed.slice(2) };
  if (slashed.startsWith("/")) return { prefix: "/", rest: slashed.slice(1) };
  return { prefix: "", rest: slashed };
}

function collapseSegments(rest: string): string[] {
  const out: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out;
}

/** Forward slashes, upper-case drive letter, no `.`/`..`/empty segments, no trailing slash. */
export function normalizePath(path: string): string {
  const { prefix, rest } = splitRoot(path.replaceAll("\\", "/"));
  return prefix + collapseSegments(rest).join("/");
}

export function resolvePath(root: string | null, path: string): string | null {
  if (isAbsolutePath(path)) return normalizePath(path);
  if (root === null) return null;
  return normalizePath(`${root}/${path}`);
}

export function isInside(root: string, path: string): boolean {
  const base = normalizePath(root);
  const target = normalizePath(path);
  if (target === base) return true;
  return target.startsWith(base.endsWith("/") ? base : `${base}/`);
}

export function relativeTo(root: string, path: string): string {
  const base = normalizePath(root);
  const target = normalizePath(path);
  if (!isInside(base, target)) return target;
  return target.slice(base.length).replace(/^\//, "");
}

export function parentDir(path: string): string | null {
  const { prefix, rest } = splitRoot(normalizePath(path));
  const segments = rest.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return null;
  if (segments.length === 1) return prefix === "" ? null : prefix;
  return prefix + segments.slice(0, -1).join("/");
}

export function baseName(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
