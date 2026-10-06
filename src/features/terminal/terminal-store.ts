import { createStore } from "zustand";

import { describeExit } from "./pty-protocol";
import { TAB_TITLE_MAX_LENGTH, TAB_TITLE_PREFIX } from "./terminal-constants";

export type TabStatus =
  | { kind: "starting" }
  | { kind: "running" }
  | { kind: "exited"; code: number | null }
  | { kind: "failed"; message: string };

export interface TerminalTab {
  id: string;
  title: string;
  status: TabStatus;
}

export interface TerminalState {
  tabs: TerminalTab[];
  activeId: string | null;
  nextOrdinal: number;
  addTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  setActive: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  setStatus: (id: string, status: TabStatus) => void;
}

export type TerminalStore = ReturnType<typeof createTerminalStore>;

export function describeStatus(status: TabStatus): string {
  switch (status.kind) {
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "exited":
      return describeExit(status.code);
    case "failed":
      return `Failed: ${status.message}`;
  }
}

export function hasTab(tabs: readonly TerminalTab[], id: string): boolean {
  return tabs.some((tab) => tab.id === id);
}

function neighbourAfterClose(tabs: readonly TerminalTab[], closedId: string): string | null {
  const index = tabs.findIndex((tab) => tab.id === closedId);
  const remaining = tabs.filter((tab) => tab.id !== closedId);
  return remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
}

function requireTab(tabs: readonly TerminalTab[], id: string): void {
  if (!hasTab(tabs, id)) throw new Error(`Unknown terminal tab: ${id}`);
}

export function createTerminalStore() {
  return createStore<TerminalState>()((set, get) => ({
    tabs: [],
    activeId: null,
    nextOrdinal: 1,

    addTab: (id) => {
      const { tabs, nextOrdinal } = get();
      if (hasTab(tabs, id)) throw new Error(`Terminal tab already exists: ${id}`);
      const tab: TerminalTab = {
        id,
        title: `${TAB_TITLE_PREFIX} ${nextOrdinal}`,
        status: { kind: "starting" },
      };
      set({ tabs: [...tabs, tab], activeId: id, nextOrdinal: nextOrdinal + 1 });
    },

    closeTab: (id) => {
      const { tabs, activeId } = get();
      if (!hasTab(tabs, id)) return;
      set({
        tabs: tabs.filter((tab) => tab.id !== id),
        activeId: activeId === id ? neighbourAfterClose(tabs, id) : activeId,
      });
    },

    closeAllTabs: () => {
      set({ tabs: [], activeId: null });
    },

    setActive: (id) => {
      requireTab(get().tabs, id);
      set({ activeId: id });
    },

    renameTab: (id, title) => {
      requireTab(get().tabs, id);
      const next = title.trim().slice(0, TAB_TITLE_MAX_LENGTH);
      if (next === "") return;
      set({ tabs: get().tabs.map((tab) => (tab.id === id ? { ...tab, title: next } : tab)) });
    },

    setStatus: (id, status) => {
      if (!hasTab(get().tabs, id)) return;
      set({ tabs: get().tabs.map((tab) => (tab.id === id ? { ...tab, status } : tab)) });
    },
  }));
}
