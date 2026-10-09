import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { StateStorage } from "zustand/middleware";

import { createSafeStorage } from "@/shared/lib/safe-storage";

import { PANE_LIMITS, LAYOUT_STORAGE_KEY, LAYOUT_STORAGE_VERSION, RIGHT_VIEWS } from "./layout-constants";
import { DEFAULT_LAYOUT, createLayoutStore } from "./layout-store";

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

function persistedEntry(state: unknown): string {
  return JSON.stringify({ state, version: LAYOUT_STORAGE_VERSION });
}

let warn: ReturnType<typeof spyOn<Console, "warn">>;

beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe("layout store defaults and actions", () => {
  test("starts from defaults when nothing is stored", () => {
    const { storage } = memoryStorage();
    const store = createLayoutStore(storage);

    expect(store.getState()).toMatchObject(DEFAULT_LAYOUT);
    expect(warn).not.toHaveBeenCalled();
  });

  test("clamps pane sizes to their limits", () => {
    const store = createLayoutStore(memoryStorage().storage);

    store.getState().setSidebarWidth(10);
    expect(store.getState().sidebarWidth).toBe(PANE_LIMITS.sidebar.min);

    store.getState().setRightWidth(99_999);
    expect(store.getState().rightWidth).toBe(PANE_LIMITS.right.max);

    store.getState().setTerminalHeight(-5);
    expect(store.getState().terminalHeight).toBe(PANE_LIMITS.terminal.min);
  });

  test("toggles the terminal drawer and clamps the graph width", () => {
    const store = createLayoutStore(memoryStorage().storage);

    store.getState().toggleTerminal();
    expect(store.getState().terminalOpen).toBe(!DEFAULT_LAYOUT.terminalOpen);

    store.getState().setGraphWidth(10);
    expect(store.getState().graphWidth).toBe(PANE_LIMITS.graph.min);

    store.getState().setRightView("split");
    expect(store.getState().rightView).toBe("split");
  });

  test("shows the terminal drawer without toggling it closed", () => {
    const store = createLayoutStore(memoryStorage().storage);

    store.getState().showTerminal();
    store.getState().showTerminal();

    expect(store.getState().terminalOpen).toBe(true);
  });

  test("offers the Changes view after Files, Graph and Split", () => {
    expect(RIGHT_VIEWS).toEqual(["files", "graph", "split", "changes"]);
    const store = createLayoutStore(memoryStorage().storage);

    store.getState().setRightView("changes");
    expect(store.getState().rightView).toBe("changes");
  });
});

describe("layout store persistence", () => {
  test("writes only layout state, not actions, under the storage key", () => {
    const { data, storage } = memoryStorage();
    const store = createLayoutStore(storage);

    store.getState().setSidebarWidth(310);
    store.getState().setGraphWidth(500);

    const raw = data.get(LAYOUT_STORAGE_KEY);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw ?? "")).toEqual({
      state: { ...DEFAULT_LAYOUT, sidebarWidth: 310, graphWidth: 500 },
      version: LAYOUT_STORAGE_VERSION,
    });
  });

  test("restores previously persisted state", () => {
    const { storage } = memoryStorage({
      [LAYOUT_STORAGE_KEY]: persistedEntry({
        ...DEFAULT_LAYOUT,
        sidebarWidth: 333,
        terminalOpen: false,
        graphWidth: 500,
      }),
    });
    const store = createLayoutStore(storage);

    expect(store.getState()).toMatchObject({
      sidebarWidth: 333,
      terminalOpen: false,
      graphWidth: 500,
    });
  });

  test("restores the Changes view as the open right view", () => {
    const { storage } = memoryStorage({
      [LAYOUT_STORAGE_KEY]: persistedEntry({ ...DEFAULT_LAYOUT, rightView: "changes" }),
    });

    expect(createLayoutStore(storage).getState().rightView).toBe("changes");
    expect(warn).not.toHaveBeenCalled();
  });

  test("discards a persisted right view that is not one of the views", () => {
    const { storage } = memoryStorage({
      [LAYOUT_STORAGE_KEY]: persistedEntry({ ...DEFAULT_LAYOUT, rightView: "review" }),
    });

    expect(createLayoutStore(storage).getState().rightView).toBe(DEFAULT_LAYOUT.rightView);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("clamps persisted sizes that fall outside the limits", () => {
    const { storage } = memoryStorage({
      [LAYOUT_STORAGE_KEY]: persistedEntry({ ...DEFAULT_LAYOUT, rightWidth: 5000, terminalHeight: 1 }),
    });
    const store = createLayoutStore(storage);

    expect(store.getState().rightWidth).toBe(PANE_LIMITS.right.max);
    expect(store.getState().terminalHeight).toBe(PANE_LIMITS.terminal.min);
  });

  test("discards a persisted payload that fails schema validation and warns", () => {
    const { storage } = memoryStorage({
      [LAYOUT_STORAGE_KEY]: persistedEntry({ ...DEFAULT_LAYOUT, terminalOpen: "yes" }),
    });
    const store = createLayoutStore(storage);

    expect(store.getState()).toMatchObject(DEFAULT_LAYOUT);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("keeps working when localStorage throws", () => {
    const store = createLayoutStore(
      createSafeStorage(() => {
        throw new Error("storage is blocked");
      }),
    );

    store.getState().setSidebarWidth(300);

    expect(store.getState().sidebarWidth).toBe(300);
    expect(warn).toHaveBeenCalled();
  });
});
