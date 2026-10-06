import { Channel, invoke } from "@tauri-apps/api/core";

import { PtyCommandError } from "./errors";
import { parsePtyMessage, type PtyMessage } from "./pty-protocol";
import { PTY_COMMANDS } from "./terminal-constants";

export interface SpawnOptions {
  id: string;
  cwd: string | null;
  cols: number;
  rows: number;
}

async function callPty(command: string, args: Record<string, unknown>): Promise<void> {
  try {
    await invoke(command, args);
  } catch (error) {
    throw new PtyCommandError(command, error);
  }
}

export async function spawnPty(
  { id, cwd, cols, rows }: SpawnOptions,
  onMessage: (message: PtyMessage) => void,
): Promise<void> {
  const onEvent = new Channel<unknown>((raw) => {
    onMessage(parsePtyMessage(raw));
  });
  await callPty(PTY_COMMANDS.spawn, { request: { id, cwd, cols, rows }, onEvent });
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
