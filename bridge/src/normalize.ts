import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { toolInputSchema, type BridgeEvent, type ToolInput } from "@flare/protocol";

import { EditStreams } from "./edit-stream";
import { FileChangeCapture, type ReadText } from "./file-capture";
import { summarizeToolResult } from "./summary";
import { classifyTool, searchResultPaths, singleFileMatches, type ToolEffect } from "./tools";

type AssistantBlock = SDKAssistantMessage["message"]["content"][number];
type TextBlock = Extract<AssistantBlock, { type: "text" }>;
type ToolUseBlock = Extract<AssistantBlock, { type: "tool_use" }>;
type UserBlock = Exclude<SDKUserMessage["message"]["content"], string>[number];
type ToolResultBlock = Extract<UserBlock, { type: "tool_result" }>;

interface ToolCall {
  effect: ToolEffect;
}

export interface NormalizerOptions {
  sessionId: string;
  cwd: string;
  readText: ReadText;
  now?: () => number;
}

export class MessageNormalizer {
  readonly #cwd: string;
  readonly #capture: FileChangeCapture;
  readonly #edits: EditStreams;
  readonly #calls = new Map<string, ToolCall>();
  readonly #turnErrors = new Set<string>();
  #sessionId: string;
  #turnOpen = false;

  constructor(options: NormalizerOptions) {
    this.#cwd = options.cwd;
    this.#sessionId = options.sessionId;
    this.#capture = new FileChangeCapture(options.readText);
    this.#edits = new EditStreams({ cwd: options.cwd, now: options.now ?? Date.now });
  }

  async normalize(message: SDKMessage): Promise<BridgeEvent[]> {
    const started = this.#startTurn(message);
    return [...started, ...(await this.#dispatch(message))];
  }

  async #dispatch(message: SDKMessage): Promise<BridgeEvent[]> {
    switch (message.type) {
      case "stream_event":
        return [...textDeltaEvents(message), ...this.#edits.handle(message)];
      case "assistant":
        return this.#assistantEvents(message);
      case "user":
        return this.#userEvents(message);
      case "result":
        return this.#resultEvents(message);
      case "system":
        return message.subtype === "init" ? this.#initEvents(message) : [];
      default:
        return [];
    }
  }

  // The SDK has no turn-start message, so a turn begins with the first thing the main agent says after the last result.
  #startTurn(message: SDKMessage): BridgeEvent[] {
    const working = (message.type === "stream_event" || message.type === "assistant") && message.parent_tool_use_id === null;
    if (!working || this.#turnOpen) return [];
    this.#turnOpen = true;
    return [{ type: "turn.started" }];
  }

  beginTool(toolUseId: string, name: string, input: unknown): Promise<void> {
    const effect = classifyTool(name, input, this.#cwd);
    return effect.kind === "change" ? this.#capture.begin(toolUseId, effect.path) : Promise.resolve();
  }

  reset(): void {
    this.#calls.clear();
    this.#capture.clear();
    this.#edits.reset();
    this.#turnOpen = false;
  }

  #initEvents(message: SDKSystemMessage): BridgeEvent[] {
    if (message.session_id === this.#sessionId) return [];
    this.#sessionId = message.session_id;
    return [{ type: "session.ready", sessionId: message.session_id }];
  }

  async #assistantEvents(message: SDKAssistantMessage): Promise<BridgeEvent[]> {
    const toolUses = message.message.content.filter(isToolUse);
    const events = message.parent_tool_use_id === null ? this.#assistantTextEvents(message) : [];
    for (const block of toolUses) events.push(...this.#toolStartedEvents(block));
    await Promise.all(toolUses.map((block) => this.beginTool(block.id, block.name, block.input)));
    return events;
  }

  #assistantTextEvents(message: SDKAssistantMessage): BridgeEvent[] {
    const text = message.message.content
      .filter(isText)
      .map((block) => block.text)
      .join("");
    if (message.error !== undefined) return this.#errorEvents(text.trim() || `Claude Code reported ${message.error}`);
    return text.length > 0 ? [{ type: "assistant.message", id: message.uuid, text }] : [];
  }

  #toolStartedEvents(block: ToolUseBlock): BridgeEvent[] {
    const input = toToolInput(block.input);
    const effect = classifyTool(block.name, input, this.#cwd);
    this.#calls.set(block.id, { effect });
    const started: BridgeEvent = { type: "tool.started", toolUseId: block.id, name: block.name, input };
    if (effect.kind !== "read") return [started];
    return [started, { type: "file.read", toolUseId: block.id, path: effect.path, range: effect.range }];
  }

  async #userEvents(message: SDKUserMessage): Promise<BridgeEvent[]> {
    const content = message.message.content;
    const results = typeof content === "string" ? [] : content.filter(isToolResult);
    const structured = results.length === 1 ? message.tool_use_result : undefined;
    const events: BridgeEvent[] = [];
    for (const block of results) events.push(...(await this.#toolFinishedEvents(block, structured)));
    return events;
  }

  async #toolFinishedEvents(block: ToolResultBlock, structured: unknown): Promise<BridgeEvent[]> {
    const toolUseId = block.tool_use_id;
    const isError = block.is_error === true;
    const effect = this.#calls.get(toolUseId)?.effect;
    this.#calls.delete(toolUseId);

    const finished: BridgeEvent = {
      type: "tool.finished",
      toolUseId,
      isError,
      summary: summarizeToolResult(block.content),
    };
    // The change goes first so the app can tell a finished edit that landed from one that never did.
    const changes = await this.#capture.finish(toolUseId, isError);
    return [...changes, finished, ...(isError ? [] : searchReadEvents(toolUseId, effect, structured, this.#cwd))];
  }

  #resultEvents(message: SDKResultMessage): BridgeEvent[] {
    this.#turnOpen = false;
    this.#edits.reset();
    const failure = resultFailure(message);
    const errors = failure === null ? [] : this.#errorEvents(failure);
    this.#turnErrors.clear();
    const { usage } = message;
    const completed: BridgeEvent = {
      type: "turn.completed",
      costUsd: message.total_cost_usd,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadInputTokens: usage.cache_read_input_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens,
      },
    };
    return [...errors, completed];
  }

  #errorEvents(text: string): BridgeEvent[] {
    if (this.#turnErrors.has(text)) return [];
    this.#turnErrors.add(text);
    return [{ type: "error", message: text }];
  }
}

function searchReadEvents(toolUseId: string, effect: ToolEffect | undefined, structured: unknown, cwd: string): BridgeEvent[] {
  if (effect?.kind !== "search") return [];
  const matches = singleFileMatches(effect, structured);
  if (matches !== null) {
    return [{ type: "file.read", toolUseId, path: matches.path, pattern: matches.pattern, matchLines: matches.matchLines }];
  }
  return searchResultPaths(structured, cwd).map((path): BridgeEvent => ({ type: "file.read", toolUseId, path }));
}

function textDeltaEvents(message: SDKPartialAssistantMessage): BridgeEvent[] {
  if (message.parent_tool_use_id !== null) return [];
  const { event } = message;
  if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") return [];
  return [{ type: "assistant.delta", text: event.delta.text }];
}

function resultFailure(message: SDKResultMessage): string | null {
  if (message.terminal_reason === "aborted_streaming" || message.terminal_reason === "aborted_tools") return null;
  if (message.subtype === "success") return message.is_error ? message.result : null;
  return message.errors.length > 0 ? message.errors.join("\n") : `The turn ended with ${message.subtype}`;
}

function toToolInput(input: unknown): ToolInput {
  const parsed = toolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : { value: input };
}

function isText(block: AssistantBlock): block is TextBlock {
  return block.type === "text";
}

function isToolUse(block: AssistantBlock): block is ToolUseBlock {
  return block.type === "tool_use";
}

function isToolResult(block: UserBlock): block is ToolResultBlock {
  return block.type === "tool_result";
}
