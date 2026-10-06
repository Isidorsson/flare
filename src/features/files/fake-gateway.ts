import type { FsGateway } from "./fs-gateway";
import { FsCommandError, type DirEntry, type FileRead, type WatchBatch } from "./fs-schemas";
import { baseName, normalizePath } from "./paths";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface FakeGateway extends FsGateway {
  disk: Map<string, string>;
  reads: string[];
  writes: { path: string; content: string }[];
  lists: string[];
  failWrites: string | null;
  holdWrites: Deferred<undefined> | null;
  batchListeners: Set<(batch: WatchBatch) => void>;
  emit: (batch: WatchBatch) => void;
  openedRoots: string[];
  closed: number;
  unsubscribed: number;
}

function listing(disk: Map<string, string>, dir: string): DirEntry[] {
  const entries = new Map<string, DirEntry>();
  for (const filePath of disk.keys()) {
    const prefix = `${dir.replace(/\/$/, "")}/`;
    if (!filePath.startsWith(prefix)) continue;
    const [first = "", ...rest] = filePath.slice(prefix.length).split("/");
    const path = `${prefix}${first}`;
    entries.set(path, { name: first, path, kind: rest.length > 0 ? "dir" : "file" });
  }
  return [...entries.values()].sort((a, b) => Number(a.kind === "file") - Number(b.kind === "file") || a.name.localeCompare(b.name));
}

export function createFakeGateway(initial: Record<string, string> = {}): FakeGateway {
  const disk = new Map(Object.entries(initial).map(([path, content]) => [normalizePath(path), content]));
  const batchListeners = new Set<(batch: WatchBatch) => void>();
  const gateway: FakeGateway = {
    disk,
    reads: [],
    writes: [],
    lists: [],
    failWrites: null,
    holdWrites: null,
    batchListeners,
    openedRoots: [],
    closed: 0,
    unsubscribed: 0,
    emit: (batch) => {
      for (const listener of batchListeners) listener(batch);
    },
    openWorkspace: (root) => {
      gateway.openedRoots.push(root);
      return Promise.resolve(normalizePath(root));
    },
    closeWorkspace: () => {
      gateway.closed += 1;
      return Promise.resolve();
    },
    listDir: (path) => {
      gateway.lists.push(path);
      return Promise.resolve({ entries: listing(disk, path), truncated: false });
    },
    readFile: (path) => {
      gateway.reads.push(path);
      const content = disk.get(normalizePath(path));
      if (content === undefined) {
        const isDirectory = [...disk.keys()].some((key) => key.startsWith(`${normalizePath(path)}/`));
        const code = isDirectory ? "is_a_directory" : "not_found";
        return Promise.reject(new FsCommandError(code, `${code}: ${baseName(path)}`));
      }
      const read: FileRead = { kind: "text", content, size: content.length };
      return Promise.resolve(read);
    },
    writeFile: async (path, content) => {
      if (gateway.failWrites !== null) throw new FsCommandError("io", gateway.failWrites);
      if (gateway.holdWrites !== null) await gateway.holdWrites.promise;
      gateway.writes.push({ path, content });
      disk.set(normalizePath(path), content);
    },
    subscribe: (onBatch) => {
      batchListeners.add(onBatch);
      return Promise.resolve(() => {
        batchListeners.delete(onBatch);
        gateway.unsubscribed += 1;
        return Promise.resolve();
      });
    },
  };
  return gateway;
}

export function batchOf(root: string, ...changes: [path: string, kind: "create" | "modify" | "remove"][]): WatchBatch {
  return { root, rescan: false, changes: changes.map(([path, kind]) => ({ path, kind })) };
}
