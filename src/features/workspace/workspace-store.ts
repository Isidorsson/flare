import { createStore } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";

export const WORKSPACE_STORAGE_KEY = "flare.workspace";

const persistedWorkspaceSchema = z.object({
  root: z.string().min(1).nullable(),
});

type PersistedWorkspace = z.infer<typeof persistedWorkspaceSchema>;

export interface WorkspaceState extends PersistedWorkspace {
  setRoot: (root: string | null) => void;
}

function mergePersistedWorkspace(persisted: unknown, current: WorkspaceState): WorkspaceState {
  if (persisted === undefined) return current;
  const parsed = persistedWorkspaceSchema.safeParse(persisted);
  if (!parsed.success) {
    console.warn("flare: discarding invalid persisted workspace", parsed.error.message);
    return current;
  }
  return { ...current, ...parsed.data };
}

export function createWorkspaceStore(storage: StateStorage) {
  return createStore<WorkspaceState>()(
    persist(
      (set) => ({
        root: null,
        setRoot: (root) => {
          set({ root });
        },
      }),
      {
        name: WORKSPACE_STORAGE_KEY,
        storage: createJSONStorage(() => storage),
        partialize: (state): PersistedWorkspace => ({ root: state.root }),
        merge: mergePersistedWorkspace,
      },
    ),
  );
}
