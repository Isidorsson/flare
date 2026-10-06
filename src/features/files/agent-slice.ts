import { isDirty, type AgentFileChange, type AgentSlice, type FilesState, type StoreContext } from "./files-types";
import { NO_USER_ACTIVITY, userHoldsEditor, type UserActivity } from "./live/follow-guard";
import { isInside, normalizePath, resolvePath } from "./paths";

type AgentData = Pick<AgentSlice, "follow" | "pane" | "changes" | "turnId" | "userActivity">;
type AgentActions = Omit<AgentSlice, keyof AgentData>;

export function initialAgentData(): AgentData {
  return { follow: true, pane: "explorer", changes: [], turnId: null, userActivity: NO_USER_ACTIVITY };
}

/**
 * Whether following the agent may move the editor right now. It never does
 * while the user is typing, has just picked a file, or has unsaved edits open.
 */
export function canFollow(state: FilesState, now: number): boolean {
  if (!state.follow || userHoldsEditor(state.userActivity, now)) return false;
  const { active } = state;
  if (active?.kind !== "file") return true;
  const file = state.files[active.path];
  return file === undefined || !isDirty(file);
}

export function recordUserActivity({ set, now }: Pick<StoreContext, "set" | "now">, kind: keyof UserActivity): void {
  const at = now();
  set((state) => ({ userActivity: { ...state.userActivity, [kind]: at } }));
}

export function agentActions(ctx: StoreContext): AgentActions {
  const { set, get, now } = ctx;

  function applyAgentFileChange(change: AgentFileChange) {
    const state = get();
    const path = resolvePath(state.root, change.path) ?? normalizePath(change.path);
    const entry = { ...change, path, id: `change-${state.changes.length + 1}` };
    set({ changes: [...state.changes, entry] });
    state.applyDiskContent(path, change.after);
    return entry;
  }

  async function noteAgentFileRead(rawPath: string) {
    const state = get();
    if (state.phase !== "ready" || state.root === null || !canFollow(state, now())) return;
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
    startTurn: (turnId) => {
      set({ turnId });
    },
    showChange: (changeId) => {
      if (!get().changes.some((change) => change.id === changeId)) return;
      recordUserActivity(ctx, "pickedAt");
      set({ active: { kind: "diff", changeId } });
    },
  };
}
