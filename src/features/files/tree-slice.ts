import type { DirState, StoreContext, TreeSlice } from "./files-types";
import { normalizePath } from "./paths";
import { errorMessage, omitKey } from "./store-utils";

export function initialTreeState(): Pick<TreeSlice, "dirs" | "expanded"> {
  return { dirs: {}, expanded: {} };
}

export function treeActions(ctx: StoreContext): Pick<TreeSlice, "loadDir" | "toggleDir"> {
  const { set, get, gateway } = ctx;

  function setDir(path: string, dir: DirState) {
    set((state) => ({ dirs: { ...state.dirs, [path]: dir } }));
  }

  async function loadDir(rawPath: string) {
    const path = normalizePath(rawPath);
    const generation = get().generation;
    if (get().dirs[path]?.status !== "ready") setDir(path, { status: "loading" });
    try {
      const listing = await gateway.listDir(path);
      if (get().generation !== generation) return;
      const entries = listing.entries.map((entry) => ({ ...entry, path: normalizePath(entry.path) }));
      setDir(path, { status: "ready", entries, truncated: listing.truncated });
    } catch (error) {
      if (get().generation !== generation) return;
      setDir(path, { status: "error", message: errorMessage(error) });
    }
  }

  async function toggleDir(rawPath: string) {
    const path = normalizePath(rawPath);
    const { expanded, dirs } = get();
    if (expanded[path] === true) {
      set({ expanded: omitKey(expanded, path) });
      return;
    }
    set({ expanded: { ...expanded, [path]: true } });
    if (dirs[path] === undefined) await loadDir(path);
  }

  return { loadDir, toggleDir };
}
