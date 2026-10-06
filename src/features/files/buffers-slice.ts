import { reconcileDisk } from "./buffer-model";
import { activating, withTab, withoutTab } from "./buffer-transitions";
import { loadFile, openPreviewQuietly, saveFile, syncFileFromDisk } from "./buffers-io";
import type { BufferActions, BufferData, OpenFileOptions, StoreContext } from "./files-types";
import { resolvePath } from "./paths";
import { updateFile } from "./store-utils";

export function initialBufferState(): BufferData {
  return { files: {}, tabs: [], active: null };
}

export function bufferActions(ctx: StoreContext): BufferActions {
  const { set, get } = ctx;

  async function openFile(rawPath: string, options: OpenFileOptions = {}) {
    const path = resolvePath(get().root, rawPath);
    if (path === null) throw new Error(`Cannot open "${rawPath}" without an open workspace`);
    const preview = options.preview ?? false;
    const existing = get().files[path];
    if (existing !== undefined) {
      set(activating(path, !preview));
      if (existing.status === "error") await loadFile(ctx, path);
      return;
    }
    if (options.quiet === true) {
      await openPreviewQuietly(ctx, path);
      return;
    }
    set(withTab(path, preview));
    await loadFile(ctx, path);
  }

  return {
    openFile,
    saveFile: (path) => saveFile(ctx, path),
    syncFromDisk: (path) => syncFileFromDisk(ctx, path),
    reloadFile: (path) => loadFile(ctx, path),
    activateFile: (path) => {
      if (get().files[path] !== undefined) set({ active: { kind: "file", path } });
    },
    closeFile: (path) => {
      set(withoutTab(path));
    },
    setDraft: (path, content) => {
      set(updateFile(path, (file) => (file.status === "ready" ? { ...file, draft: content, preview: false } : file)));
    },
    saveActive: async () => {
      const { active } = get();
      if (active?.kind === "file") await saveFile(ctx, active.path);
    },
    applyDiskContent: (path, content) => {
      set(updateFile(path, (file) => reconcileDisk(file, content)));
    },
  };
}
