import { Channel, invoke } from "@tauri-apps/api/core";

import { PtyCommandError } from "./errors";
import { parseProfiles, type LaunchProfile, type TerminalLaunch } from "./launch-profiles";
import { parseClosedCount, parsePtyMessage, type PtyMessage } from "./pty-protocol";
import { PTY_COMMANDS } from "./terminal-constants";

export interface SpawnOptions {
  id: string;
  cwd: string | null;
  launch: TerminalLaunch;
  cols: number;
  rows: number;
}

async function invokePty(command: string, args?: Record<string, unknown>): Promise<unknown> {
  try {
    return await invoke(command, args);
  } catch (error) {
    throw new PtyCommandError(command, error);
  }
}

async function callPty(command: string, args: Record<string, unknown>): Promise<void> {
  await invokePty(command, args);
}

export async function spawnPty(
  { id, cwd, launch, cols, rows }: SpawnOptions,
  onMessage: (message: PtyMessage) => void,
): Promise<void> {
  const onEvent = new Channel<unknown>((raw) => {
    onMessage(parsePtyMessage(raw));
  });
  await callPty(PTY_COMMANDS.spawn, { request: { id, cwd, launch, cols, rows }, onEvent });
}

export async function listProfiles(): Promise<LaunchProfile[]> {
  return parseProfiles(await invokePty(PTY_COMMANDS.profiles));
}

export function writePty(id: string, data: string): Promise<void> {
  return callPty(PTY_COMMANDS.write, { id, data });
}

export function resizePty(id: string, cols: number, rows: number): Promise<void> {
  return callPty(PTY_COMMANDS.resize, { id, cols, rows });
}

export function killPty(id: string): Promise<void> {
  return callPty(PTY_COMMANDS.kill, { id });
}

/** Resolves to how many terminals the backend closed. */
export async function killAllPty(): Promise<number> {
  return parseClosedCount(await invokePty(PTY_COMMANDS.killAll));
}
