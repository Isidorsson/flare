import type { FilesStore } from "../files-store";
import { isDirty } from "../files-types";
import { canFollow } from "../agent-slice";
import { isInside, resolvePath } from "../paths";
import { userIsTyping } from "./follow-guard";
import type { LiveStore } from "./live-store";
import type { PlayerHost, PreparedFile } from "./player";

export interface TypingTarget {
  file: PreparedFile | null;
  // The file does not exist yet, so an empty tab was opened to type into.
  created: boolean;
}

export interface ActivityHost extends PlayerHost {
  // The path as an absolute path inside the workspace, or null when it is outside or no folder is open.
  resolve: (rawPath: string) => string | null;
  prepareTyping: (path: string, kind: "edit" | "write") => Promise<TypingTarget>;
  closeIfStillBlank: (path: string) => void;
}

/** Connects the player to the files store (which file the editor shows) and the live store (what is drawn on it). */
export function createActivityHost(files: FilesStore, live: LiveStore, now: () => number): ActivityHost {
  function resolve(rawPath: string): string | null {
    const { root } = files.getState();
    if (root === null) return null;
    const path = resolvePath(root, rawPath);
    return path !== null && isInside(root, path) ? path : null;
  }

  function showing(path: string): PreparedFile | null {
    const state = files.getState();
    const { active } = state;
    const file = state.files[path];
    if (active?.kind !== "file" || active.path !== path) return null;
    if (file?.status !== "ready" || isDirty(file)) return null;
    return { content: file.draft, wasActive: true };
  }

  async function prepare(path: string, { forced }: { forced: boolean }): Promise<PreparedFile | null> {
    const already = showing(path);
    if (already !== null) return already;
    const state = files.getState();
    if (forced) await state.openFile(path);
    else await state.noteAgentFileRead(path);
    const opened = showing(path);
    return opened === null ? null : { ...opened, wasActive: false };
  }

  // Showing typed text makes the editor read-only, so it waits for the user to stop typing.
  async function prepareTyping(path: string, kind: "edit" | "write"): Promise<TypingTarget> {
    if (userIsTyping(files.getState().userActivity, now())) return { file: null, created: false };
    const file = await prepare(path, { forced: false });
    if (file !== null || kind !== "write") return { file, created: false };
    const state = files.getState();
    if (state.files[path] !== undefined || !canFollow(state, now())) return { file: null, created: false };
    state.openEmptyPreview(path);
    return { file: showing(path), created: true };
  }

  return {
    resolve,
    prepare,
    prepareTyping,
    setPlay: (play) => {
      live.getState().setPlay(play);
    },
    clearPlay: (id) => {
      live.getState().clearPlay(id);
    },
    closeIfStillBlank: (path) => {
      const state = files.getState();
      const file = state.files[path];
      if (file?.status === "ready" && file.saved === "" && file.draft === "") state.closeFile(path);
    },
  };
}
