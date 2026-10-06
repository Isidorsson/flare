import { describe, expect, test } from "bun:test";

import { TAB_TITLE_MAX_LENGTH } from "./terminal-constants";
import { createTerminalStore, describeStatus } from "./terminal-store";

function storeWithTabs(...ids: string[]) {
  const store = createTerminalStore();
  for (const id of ids) store.getState().addTab(id);
  return store;
}

const ids = (store: ReturnType<typeof createTerminalStore>) => store.getState().tabs.map((tab) => tab.id);

describe("terminal tab store", () => {
  test("starts empty", () => {
    const { tabs, activeId } = createTerminalStore().getState();
    expect(tabs).toEqual([]);
    expect(activeId).toBeNull();
  });

  test("adds tabs as starting, numbered and active", () => {
    const store = storeWithTabs("a", "b");

    expect(store.getState().tabs).toEqual([
      { id: "a", title: "Terminal 1", status: { kind: "starting" } },
      { id: "b", title: "Terminal 2", status: { kind: "starting" } },
    ]);
    expect(store.getState().activeId).toBe("b");
  });

  test("never reuses a title number after a tab is closed", () => {
    const store = storeWithTabs("a", "b");
    store.getState().closeTab("b");
    store.getState().addTab("c");

    expect(store.getState().tabs.map((tab) => tab.title)).toEqual(["Terminal 1", "Terminal 3"]);
  });

  test("rejects a duplicate id", () => {
    const store = storeWithTabs("a");
    expect(() => {
      store.getState().addTab("a");
    }).toThrow("already exists");
  });

  test("activates an existing tab and rejects unknown ones", () => {
    const store = storeWithTabs("a", "b");
    store.getState().setActive("a");
    expect(store.getState().activeId).toBe("a");
    expect(() => {
      store.getState().setActive("nope");
    }).toThrow("Unknown terminal tab");
  });

  describe("closing", () => {
    test("activates the tab that slides into the closed slot", () => {
      const store = storeWithTabs("a", "b", "c");
      store.getState().setActive("b");
      store.getState().closeTab("b");

      expect(ids(store)).toEqual(["a", "c"]);
      expect(store.getState().activeId).toBe("c");
    });

    test("falls back to the previous tab when the last one closes", () => {
      const store = storeWithTabs("a", "b", "c");
      store.getState().closeTab("c");

      expect(store.getState().activeId).toBe("b");
    });

    test("keeps the active tab when another one closes", () => {
      const store = storeWithTabs("a", "b", "c");
      store.getState().setActive("a");
      store.getState().closeTab("c");

      expect(store.getState().activeId).toBe("a");
    });

    test("clears the active tab when the last one closes", () => {
      const store = storeWithTabs("a");
      store.getState().closeTab("a");

      expect(store.getState().tabs).toEqual([]);
      expect(store.getState().activeId).toBeNull();
    });

    test("ignores a tab that is already closed", () => {
      const store = storeWithTabs("a");
      store.getState().closeTab("gone");

      expect(ids(store)).toEqual(["a"]);
    });
  });

  describe("renaming", () => {
    test("trims and applies the new title", () => {
      const store = storeWithTabs("a");
      store.getState().renameTab("a", "  build  ");

      expect(store.getState().tabs[0]?.title).toBe("build");
    });

    test("keeps the old title when the new one is blank", () => {
      const store = storeWithTabs("a");
      store.getState().renameTab("a", "   ");

      expect(store.getState().tabs[0]?.title).toBe("Terminal 1");
    });

    test("caps the title length", () => {
      const store = storeWithTabs("a");
      store.getState().renameTab("a", "x".repeat(TAB_TITLE_MAX_LENGTH + 10));

      expect(store.getState().tabs[0]?.title).toHaveLength(TAB_TITLE_MAX_LENGTH);
    });

    test("rejects an unknown tab", () => {
      expect(() => {
        createTerminalStore().getState().renameTab("nope", "x");
      }).toThrow("Unknown terminal tab");
    });
  });

  describe("status", () => {
    test("updates only the named tab", () => {
      const store = storeWithTabs("a", "b");
      store.getState().setStatus("a", { kind: "exited", code: 2 });

      expect(store.getState().tabs.map((tab) => tab.status.kind)).toEqual(["exited", "starting"]);
    });

    test("ignores a late update for a closed tab", () => {
      const store = storeWithTabs("a");
      store.getState().closeTab("a");
      store.getState().setStatus("a", { kind: "exited", code: 0 });

      expect(store.getState().tabs).toEqual([]);
    });

    test("describes every status for tooltips", () => {
      expect(describeStatus({ kind: "starting" })).toBe("Starting");
      expect(describeStatus({ kind: "running" })).toBe("Running");
      expect(describeStatus({ kind: "exited", code: 3 })).toBe("process exited with code 3");
      expect(describeStatus({ kind: "exited", code: null })).toBe("process exited");
      expect(describeStatus({ kind: "failed", message: "no shell" })).toBe("Failed: no shell");
    });
  });
});
