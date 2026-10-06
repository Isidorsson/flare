import type { ColorizedLine } from "./colorized-html";
import type { AgentFileChange, OpenFileOptions } from "./files-types";
import type { AgentFileEditing, AgentFileRead } from "./live/agent-activity";
import { agentActivity } from "./live/use-live";
import { filesStore } from "./use-files";

export type { ColorizedLine, ColorizedSpan } from "./colorized-html";
export type { AgentChangeKind, AgentFileChange, OpenFileOptions } from "./files-types";
export type { AgentFileEditing, AgentFileRead } from "./live/agent-activity";

/** Wire to the bridge `file.change` event, supplying the turn the event belongs to. */
export function applyAgentFileChange(change: AgentFileChange): void {
  agentActivity.applyChange(change);
}

/** Wire to the bridge `file.read` event: heats the file and, while Follow agent is on, shows the lines read. */
export function noteAgentFileRead(read: AgentFileRead): void {
  agentActivity.noteRead(read);
}

/** Wire to the bridge `file.editing` event: the edit the model is typing, shown before the tool runs. */
export function noteAgentFileEditing(editing: AgentFileEditing): void {
  agentActivity.noteEditing(editing);
}

/** Wire to `tool.finished`: drops the typed preview of an edit that never produced a change. */
export function endAgentFileEditing(toolUseId: string): void {
  agentActivity.endEditing(toolUseId);
}

/** Wire to `turn.started`: the turn strip starts over. */
export function startAgentTurn(turnId: string): void {
  agentActivity.startTurn(turnId);
}

/** Wire to `turn.completed`: nothing typed on screen survives the end of a turn. */
export function endAgentTurn(): void {
  agentActivity.endTurn();
}

/** Accepts an absolute or workspace-relative path; `options.line` scrolls the editor there. Read failures show up in the file's tab. */
export function openFile(path: string, options?: OpenFileOptions): Promise<void> {
  return filesStore.getState().openFile(path, options);
}

/** Colours a snippet with the editor's tokenizer and theme. Monaco loads on first use; null means no such language. */
export async function colorizeCode(code: string, languageHint: string): Promise<ColorizedLine[] | null> {
  const { colorizeCode: colorize } = await import("./colorize");
  return colorize(code, languageHint);
}
