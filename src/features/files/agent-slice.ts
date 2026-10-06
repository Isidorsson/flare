import { isDirty, type AgentFileChange, type AgentSlice, type FilesState, type StoreContext } from "./files-types";
import { isInside, normalizePath, resolvePath } from "./paths";

type AgentData = Pick<AgentSlice, "follow" | "pane" | "changes">;
type AgentActions = Omit<AgentSlice, keyof AgentData>;

export function initialAgentData(): AgentData {
  return { follow: true, pane: "explorer", changes: [] };
}

/** Follow mode never pulls the view away from a file with unsaved edits. */
function canFollow(state: FilesState): boolean {
  if (!state.follow) return false;
  const { active } = state;
  if (active?.kind !== "file") return true;
  const file = state.files[active.path];
  return file === undefined || !isDirty(file);
}

export function agentActions(ctx: StoreContext): AgentActions {
  const { set, get } = ctx;

  function applyAgentFileChange(change: AgentFileChange) {
    const state = get();
    const id = `change-${state.changes.length + 1}`;
    const path = resolvePath(state.root, change.path) ?? normalizePath(change.path);
    set({ changes: [...state.changes, { ...change, path, id }] });
    if (change.kind === "delete") state.applyDiskContent(path, null);
    else if (change.after !== null) state.applyDiskContent(path, change.after);
    if (canFollow(state)) set({ active: { kind: "diff", changeId: id } });
  }

  async function noteAgentFileRead(rawPath: string) {
    const state = get();
    if (state.phase !== "ready" || state.root === null || !canFollow(state)) return;
    const path = resolvePath(state.root, rawPath);
    if (path === null || !isInside(state.root, path)) return;
    await state.openFile(path, { preview: true, quiet: true });
  }

  return {
    applyAgentFileChange,
    noteAgentFileRead,
    setFollow: (follow) => {
      set({ follow });
    },
    setPane: (pane) => {
      set({ pane });
    },
    showChange: (changeId) => {
      if (get().changes.some((change) => change.id === changeId)) set({ active: { kind: "diff", changeId } });
    },
  };
}
