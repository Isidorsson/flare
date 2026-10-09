import { createStore } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";

import { toError } from "./errors";
import type { LaunchProfile } from "./launch-profiles";

export const PROFILES_STORAGE_KEY = "flare.terminal-profiles";

const persistedProfilesSchema = z.object({ defaultProfileId: z.string().nullable() });

type ProfilesLoad =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; profiles: LaunchProfile[] }
  | { kind: "failed"; message: string };

export interface ProfilesState {
  load: ProfilesLoad;
  /** The user's pick; `null` follows the system default shell. */
  defaultProfileId: string | null;
  refresh: () => Promise<void>;
  setDefaultProfile: (id: string) => void;
}

export interface ProfilesStoreDeps {
  storage: StateStorage;
  listProfiles: () => Promise<LaunchProfile[]>;
}

function mergePersistedProfiles(persisted: unknown, current: ProfilesState): ProfilesState {
  if (persisted === undefined) return current;
  const parsed = persistedProfilesSchema.safeParse(persisted);
  if (!parsed.success) {
    console.warn("flare: discarding invalid persisted terminal profile", parsed.error.message);
    return current;
  }
  return { ...current, ...parsed.data };
}

export function loadedProfiles(state: ProfilesState): LaunchProfile[] {
  return state.load.kind === "loaded" ? state.load.profiles : [];
}

export function createProfilesStore({ storage, listProfiles }: ProfilesStoreDeps) {
  return createStore<ProfilesState>()(
    persist(
      (set) => ({
        load: { kind: "idle" },
        defaultProfileId: null,
        refresh: async () => {
          set((state) => (state.load.kind === "loaded" ? state : { load: { kind: "loading" } }));
          try {
            set({ load: { kind: "loaded", profiles: await listProfiles() } });
          } catch (error) {
            console.error("flare: failed to list terminal profiles", error);
            set({ load: { kind: "failed", message: toError(error).message } });
          }
        },
        setDefaultProfile: (id) => {
          set({ defaultProfileId: id });
        },
      }),
      {
        name: PROFILES_STORAGE_KEY,
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({ defaultProfileId: state.defaultProfileId }),
        merge: mergePersistedProfiles,
      },
    ),
  );
}

export type ProfilesStore = ReturnType<typeof createProfilesStore>;
