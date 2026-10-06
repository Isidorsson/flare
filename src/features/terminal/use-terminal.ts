import { useStore } from "zustand";

import { workspaceStore } from "@/features/workspace/use-workspace";

import { createGhosttySession } from "./ghostty-session";
import { killAllPty } from "./pty-api";
import { createTerminalController } from "./terminal-controller";
import { createTerminalStore, type TerminalState } from "./terminal-store";

const terminalStore = createTerminalStore();

export const terminalController = createTerminalController({
  store: terminalStore,
  createSession: createGhosttySession,
  killAll: killAllPty,
  getCwd: () => workspaceStore.getState().root,
  newId: () => crypto.randomUUID(),
});

export function useTerminal<T>(selector: (state: TerminalState) => T): T {
  return useStore(terminalStore, selector);
}
