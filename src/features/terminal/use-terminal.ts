import { useStore } from "zustand";

import { workspaceStore } from "@/features/workspace/use-workspace";
import { createSafeStorage } from "@/shared/lib/safe-storage";

import { createGhosttySession } from "./ghostty-session";
import { claudeTab, resolveDefaultShell, shellTab, type LaunchProfile } from "./launch-profiles";
import { createProfilesStore, loadedProfiles, type ProfilesState } from "./profiles-store";
import { killAllPty, listProfiles } from "./pty-api";
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

const profilesStore = createProfilesStore({
  storage: createSafeStorage(() => window.localStorage),
  listProfiles,
});

void profilesStore.getState().refresh();

export function useTerminal<T>(selector: (state: TerminalState) => T): T {
  return useStore(terminalStore, selector);
}

export function useTerminalProfiles<T>(selector: (state: ProfilesState) => T): T {
  return useStore(profilesStore, selector);
}

export function selectDefaultShell(state: ProfilesState): LaunchProfile | null {
  return resolveDefaultShell(loadedProfiles(state), state.defaultProfileId);
}

export function openShellTerminal(profile: LaunchProfile): void {
  terminalController.openTab(shellTab(profile));
}

export function openDefaultTerminal(): void {
  terminalController.openTab(shellTab(selectDefaultShell(profilesStore.getState())));
}

/** A fresh Claude Code session, or a fork of `resume` so the chat keeps its own history. */
export function openClaudeTerminal(resume: string | null = null): void {
  terminalController.openTab(claudeTab(resume));
}
