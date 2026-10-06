import type { FilesState, OpenFile } from "./files-types";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

export function updateFile(path: string, change: (file: OpenFile) => OpenFile) {
  return (state: FilesState): Partial<FilesState> => {
    const file = state.files[path];
    return file === undefined ? {} : { files: { ...state.files, [path]: change(file) } };
  };
}

export function patchFile(path: string, patch: Partial<OpenFile>) {
  return updateFile(path, (file) => ({ ...file, ...patch }));
}
