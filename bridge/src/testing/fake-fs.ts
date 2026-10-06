import type { ReadText } from "../file-capture";

export interface FakeFs {
  readText: ReadText;
  write(path: string, content: string): void;
  remove(path: string): void;
  failReads(path: string, message: string): void;
}

export function createFakeFs(initial: Record<string, string> = {}): FakeFs {
  const files = new Map(Object.entries(initial));
  const failures = new Map<string, string>();
  return {
    readText: (path) => {
      const failure = failures.get(path);
      if (failure !== undefined) return Promise.reject(new Error(failure));
      return Promise.resolve(files.get(path) ?? null);
    },
    write: (path, content) => {
      files.set(path, content);
    },
    remove: (path) => {
      files.delete(path);
    },
    failReads: (path, message) => {
      failures.set(path, message);
    },
  };
}
