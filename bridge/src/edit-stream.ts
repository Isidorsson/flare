import { resolve } from "node:path";

import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import { MAX_EDITING_TEXT_CHARS, type BridgeEventOf, type FileEditingKind } from "@flare/protocol";

import { isSamePath, parsePartialJson, valueAt, type JsonValue, type PartialJson, type PathKey } from "./partial-json";

export const EDITING_THROTTLE_MS = 50;

type FileEditingEvent = BridgeEventOf<"file.editing">;
type StreamEvent = SDKPartialAssistantMessage["event"];

interface Stream {
  toolUseId: string;
  tool: StreamedTool;
  json: string;
  lastEmitAt: number;
  last: FileEditingEvent | null;
}

type StreamedTool = "Edit" | "MultiEdit" | "Write";

export interface EditStreamOptions {
  cwd: string;
  now: () => number;
}

const STREAMED_TOOLS: ReadonlySet<string> = new Set<StreamedTool>(["Edit", "MultiEdit", "Write"]);

function isStreamedTool(name: string): name is StreamedTool {
  return STREAMED_TOOLS.has(name);
}

/**
 * Follows the partial JSON of Edit, MultiEdit and Write inputs while the model
 * is still typing them and reports the text so far, at most once per throttle
 * window, so the app can show the edit before the tool runs.
 */
export class EditStreams {
  readonly #options: EditStreamOptions;
  readonly #streams = new Map<number, Stream>();

  constructor(options: EditStreamOptions) {
    this.#options = options;
  }

  handle(message: SDKPartialAssistantMessage): FileEditingEvent[] {
    if (message.parent_tool_use_id !== null) return [];
    const { event } = message;
    switch (event.type) {
      case "message_start":
      case "message_stop":
        this.#streams.clear();
        return [];
      case "content_block_start":
        this.#begin(event);
        return [];
      case "content_block_delta":
        return this.#append(event);
      case "content_block_stop":
        return this.#finish(event.index);
      default:
        return [];
    }
  }

  reset(): void {
    this.#streams.clear();
  }

  #begin(event: Extract<StreamEvent, { type: "content_block_start" }>): void {
    const block = event.content_block;
    if (block.type !== "tool_use" || !isStreamedTool(block.name)) return;
    this.#streams.set(event.index, { toolUseId: block.id, tool: block.name, json: "", lastEmitAt: 0, last: null });
  }

  #append(event: Extract<StreamEvent, { type: "content_block_delta" }>): FileEditingEvent[] {
    const stream = this.#streams.get(event.index);
    if (stream === undefined || event.delta.type !== "input_json_delta") return [];
    stream.json += event.delta.partial_json;
    const now = this.#options.now();
    if (now - stream.lastEmitAt < EDITING_THROTTLE_MS) return [];
    stream.lastEmitAt = now;
    return this.#snapshot(stream);
  }

  #finish(index: number): FileEditingEvent[] {
    const stream = this.#streams.get(index);
    if (stream === undefined) return [];
    this.#streams.delete(index);
    return this.#snapshot(stream);
  }

  #snapshot(stream: Stream): FileEditingEvent[] {
    const next = editingEvent(stream.toolUseId, stream.tool, parsePartialJson(stream.json), this.#options.cwd);
    if (next === null || isSameEditing(stream.last, next)) return [];
    stream.last = next;
    return [next];
  }
}

function isSameEditing(previous: FileEditingEvent | null, next: FileEditingEvent): boolean {
  return (
    previous !== null &&
    previous.path === next.path &&
    previous.text === next.text &&
    previous.oldString === next.oldString
  );
}

/** The editing event for the input received so far, or null while the file path is still unknown. */
export function editingEvent(
  toolUseId: string,
  tool: StreamedTool,
  input: PartialJson,
  cwd: string,
): FileEditingEvent | null {
  const filePath = completeString(input, [], "file_path");
  if (filePath === null || filePath === "") return null;
  const path = resolve(cwd, filePath);
  if (tool === "Write") {
    return build({ toolUseId, path, kind: "write", oldString: undefined, text: partialString(input, [], "content") });
  }
  const base = tool === "MultiEdit" ? lastEditPath(input.value) : [];
  const oldString = completeString(input, base, "old_string");
  if (oldString === null || oldString.length > MAX_EDITING_TEXT_CHARS) return null;
  return build({ toolUseId, path, kind: "edit", oldString, text: partialString(input, base, "new_string") });
}

// MultiEdit applies its edits in order, so the one still being typed is the last in the array.
function lastEditPath(root: JsonValue | undefined): PathKey[] {
  const edits = valueAt(root, ["edits"]);
  return ["edits", Array.isArray(edits) ? Math.max(0, edits.length - 1) : 0];
}

// A string that is still being typed is not trusted as an identifier (a path, the text to replace).
function completeString(input: PartialJson, base: readonly PathKey[], key: string): string | null {
  const path = [...base, key];
  const value = valueAt(input.value, path);
  if (typeof value !== "string" || isSamePath(input.openString, path)) return null;
  return value;
}

function partialString(input: PartialJson, base: readonly PathKey[], key: string): string {
  const value = valueAt(input.value, [...base, key]);
  return typeof value === "string" ? value : "";
}

interface EditingParts {
  toolUseId: string;
  path: string;
  kind: FileEditingKind;
  oldString: string | undefined;
  text: string;
}

function build({ toolUseId, path, kind, oldString, text }: EditingParts): FileEditingEvent {
  const capped = text.length > MAX_EDITING_TEXT_CHARS ? text.slice(0, MAX_EDITING_TEXT_CHARS) : text;
  const base = { type: "file.editing", toolUseId, path, kind, text: capped } as const;
  return oldString === undefined ? base : { ...base, oldString };
}
