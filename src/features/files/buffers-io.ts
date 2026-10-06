import { afterSave, fromRead, reconcileDisk } from "./buffer-model";
import { withTab } from "./buffer-transitions";
import { isDirty, type StoreContext } from "./files-types";
import { FsCommandError, isNotFound } from "./fs-schemas";
import { errorMessage, patchFile, updateFile } from "./store-utils";

const EXPECTED_QUIET_MISSES = new Set(["is_a_directory", "not_found", "outside_workspace"]);

/** Reads a file into an already-open tab, replacing whatever the tab held. */
export async function loadFile({ set, get, gateway }: StoreContext, path: string) {
  const generation = get().generation;
  try {
    const read = await gateway.readFile(path);
    if (get().generation !== generation) return;
    set(updateFile(path, (file) => fromRead(file, read)));
  } catch (error) {
    if (get().generation !== generation) return;
    set(patchFile(path, { status: "error", error: errorMessage(error) }));
  }
}

/**
 * Opens a preview tab only if the read succeeds. Used when following the
 * agent, where reads of directories or missing paths are routine, not errors.
 */
export async function openPreviewQuietly({ set, get, gateway }: StoreContext, path: string) {
  const generation = get().generation;
  try {
    const read = await gateway.readFile(path);
    if (get().generation !== generation || get().files[path] !== undefined) return;
    set(withTab(path, true));
    set(updateFile(path, (file) => fromRead(file, read)));
  } catch (error) {
    const expected = error instanceof FsCommandError && EXPECTED_QUIET_MISSES.has(error.code);
    if (!expected) console.warn(`flare: could not follow the agent into ${path}`, error);
  }
}

export async function saveFile({ set, get, gateway }: StoreContext, path: string) {
  const file = get().files[path];
  if (file?.status !== "ready" || file.saving) return;
  if (!isDirty(file) && file.conflict === null) return;
  const content = file.draft;
  set(patchFile(path, { saving: true, error: null }));
  try {
    await gateway.writeFile(path, content);
    set(updateFile(path, (current) => afterSave(current, content)));
  } catch (error) {
    set(patchFile(path, { saving: false, error: errorMessage(error) }));
  }
}

/** Re-reads an open file after an external change, keeping unsaved edits and flagging conflicts. */
export async function syncFileFromDisk({ set, get, gateway }: StoreContext, path: string) {
  const generation = get().generation;
  try {
    const read = await gateway.readFile(path);
    if (get().generation !== generation) return;
    set(updateFile(path, (file) => (read.kind === "text" ? reconcileDisk(file, read.content) : fromRead(file, read))));
  } catch (error) {
    if (get().generation !== generation) return;
    const failed = isNotFound(error)
      ? updateFile(path, (file) => reconcileDisk(file, null))
      : patchFile(path, { error: errorMessage(error) });
    set(failed);
  }
}
