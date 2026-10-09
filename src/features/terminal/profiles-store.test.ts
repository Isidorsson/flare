import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { StateStorage } from "zustand/middleware";

import type { LaunchProfile } from "./launch-profiles";
import { PROFILES_STORAGE_KEY, createProfilesStore, loadedProfiles } from "./profiles-store";

const pwsh: LaunchProfile = { id: "pwsh", label: "PowerShell", kind: "shell" };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StateStorage = {
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, value) => {
      data.set(name, value);
    },
    removeItem: (name) => {
      data.delete(name);
    },
  };
  return { data, storage };
}

let consoleError: ReturnType<typeof spyOn<Console, "error">>;
let consoleWarn: ReturnType<typeof spyOn<Console, "warn">>;

beforeEach(() => {
  consoleError = spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

describe("terminal profiles store", () => {
  test("loads the profiles the backend lists", async () => {
    const store = createProfilesStore({ storage: memoryStorage().storage, listProfiles: () => Promise.resolve([pwsh]) });

    expect(store.getState().load).toEqual({ kind: "idle" });
    await store.getState().refresh();

    expect(loadedProfiles(store.getState())).toEqual([pwsh]);
  });

  test("records a failed listing and offers no profiles", async () => {
    const store = createProfilesStore({
      storage: memoryStorage().storage,
      listProfiles: () => Promise.reject(new Error("no pty")),
    });

    await store.getState().refresh();

    expect(store.getState().load).toEqual({ kind: "failed", message: "no pty" });
    expect(loadedProfiles(store.getState())).toEqual([]);
  });

  test("keeps the loaded list visible while a refresh runs", async () => {
    let calls = 0;
    const store = createProfilesStore({
      storage: memoryStorage().storage,
      listProfiles: () => (++calls === 1 ? Promise.resolve([pwsh]) : new Promise<LaunchProfile[]>(() => undefined)),
    });
    await store.getState().refresh();

    void store.getState().refresh();

    expect(loadedProfiles(store.getState())).toEqual([pwsh]);
  });

  test("persists only the chosen default and restores it", () => {
    const { data, storage } = memoryStorage();
    const store = createProfilesStore({ storage, listProfiles: () => Promise.resolve([]) });

    store.getState().setDefaultProfile("git-bash");
    const restored = createProfilesStore({ storage, listProfiles: () => Promise.resolve([]) });

    expect(JSON.parse(data.get(PROFILES_STORAGE_KEY) ?? "{}")).toEqual({ state: { defaultProfileId: "git-bash" }, version: 0 });
    expect(restored.getState().defaultProfileId).toBe("git-bash");
  });

  test("ignores a corrupt persisted default", () => {
    const { storage } = memoryStorage({ [PROFILES_STORAGE_KEY]: JSON.stringify({ state: { defaultProfileId: 7 } }) });
    const store = createProfilesStore({ storage, listProfiles: () => Promise.resolve([]) });

    expect(store.getState().defaultProfileId).toBeNull();
  });
});
