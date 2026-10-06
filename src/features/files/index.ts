import { filesStore } from "./use-files";
import type { AgentFileChange, OpenFileOptions } from "./files-types";

export type { AgentChangeKind, AgentFileChange, OpenFileOptions } from "./files-types";

/** Wire to the bridge `file.change` event, supplying the turn the event belongs to. */
export function applyAgentFileChange(change: AgentFileChange): void {
  filesStore.getState().applyAgentFileChange(change);
}

/** Wire to the bridge `file.read` event; only does anything while Follow agent is on. */
export function noteAgentFileRead(path: string): Promise<void> {
  return filesStore.getState().noteAgentFileRead(path);
}

/** Accepts an absolute or workspace-relative path. Read failures show up in the file's tab. */
export function openFile(path: string, options?: OpenFileOptions): Promise<void> {
  return filesStore.getState().openFile(path, options);
}
