import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { StateStorage } from "zustand/middleware";

import { WORKSPACE_STORAGE_KEY, createWorkspaceStore } from "./workspace-store";

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

let warn: ReturnType<typeof spyOn<Console, "warn">>;

beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe("workspace store", () => {
  test("starts with no root", () => {
    const store = createWorkspaceStore(memoryStorage().storage);
    expect(store.getState().root).toBeNull();
  });

  test("persists the chosen root", () => {
    const { data, storage } = memoryStorage();
    createWorkspaceStore(storage).getState().setRoot("C:/code/app");
    expect(createWorkspaceStore(storage).getState().root).toBe("C:/code/app");
    expect(data.has(WORKSPACE_STORAGE_KEY)).toBe(true);
  });

  test("discards an invalid persisted root", () => {
    const { storage } = memoryStorage({
      [WORKSPACE_STORAGE_KEY]: JSON.stringify({ state: { root: 42 }, version: 0 }),
    });
    expect(createWorkspaceStore(storage).getState().root).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
