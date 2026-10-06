import type {
  NonNullableUsage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

type Uuid = `${string}-${string}-${string}-${string}-${string}`;
type AssistantContent = SDKAssistantMessage["message"]["content"];
type AssistantError = NonNullable<SDKAssistantMessage["error"]>;

export const SESSION_ID = "session-1";

let sequence = 0;

function nextUuid(): Uuid {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

export function textBlock(text: string): AssistantContent[number] {
  return { type: "text", text, citations: null };
}

export function toolUseBlock(id: string, name: string, input: unknown): AssistantContent[number] {
  return { type: "tool_use", id, name, input };
}

interface AssistantOptions {
  parentToolUseId?: string;
  error?: AssistantError;
}

export function assistantMessage(content: AssistantContent, options: AssistantOptions = {}): SDKAssistantMessage {
  return {
    type: "assistant",
    uuid: nextUuid(),
    session_id: SESSION_ID,
    parent_tool_use_id: options.parentToolUseId ?? null,
    ...(options.error === undefined ? {} : { error: options.error }),
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content,
      container: null,
      context_management: null,
      diagnostics: null,
      stop_details: null,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        fallback_credit: null,
        inference_geo: null,
        iterations: null,
        output_tokens_details: null,
        server_tool_use: null,
        service_tier: null,
        speed: null,
      },
    },
  };
}

export function textDelta(text: string, parentToolUseId: string | null = null): SDKPartialAssistantMessage {
  return {
    type: "stream_event",
    uuid: nextUuid(),
    session_id: SESSION_ID,
    parent_tool_use_id: parentToolUseId,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  };
}

export function thinkingDelta(thinking: string): SDKPartialAssistantMessage {
  return {
    type: "stream_event",
    uuid: nextUuid(),
    session_id: SESSION_ID,
    parent_tool_use_id: null,
    event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking, estimated_tokens: 1 } },
  };
}

interface ToolResult {
  id: string;
  content: string | { type: "text"; text: string }[];
  isError?: boolean;
}

export function toolResultMessage(results: ToolResult[], structured?: unknown): SDKUserMessage {
  return {
    type: "user",
    parent_tool_use_id: null,
    uuid: nextUuid(),
    session_id: SESSION_ID,
    message: {
      role: "user",
      content: results.map((result) => ({
        type: "tool_result",
        tool_use_id: result.id,
        content: result.content,
        ...(result.isError === undefined ? {} : { is_error: result.isError }),
      })),
    },
    ...(structured === undefined ? {} : { tool_use_result: structured }),
  };
}

export function initMessage(sessionId: string): SDKSystemMessage {
  return {
    type: "system",
    subtype: "init",
    uuid: nextUuid(),
    session_id: sessionId,
    apiKeySource: "none",
    claude_code_version: "2.1.291",
    cwd: "/work",
    tools: [],
    mcp_servers: [],
    model: "claude-sonnet-5",
    permissionMode: "default",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
  };
}

const USAGE: NonNullableUsage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 10,
  cache_creation_input_tokens: 5,
  cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 5 },
  fallback_credit: { status: { type: "redeemed" } },
  inference_geo: "us",
  iterations: [],
  output_tokens_details: { thinking_tokens: 0 },
  server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
  service_tier: "standard",
  speed: "standard",
};

interface ResultOptions {
  costUsd?: number;
  isError?: boolean;
  result?: string;
  errorSubtype?: "error_during_execution" | "error_max_turns";
  errors?: string[];
  terminalReason?: "aborted_streaming" | "completed";
}

function resultBase(options: ResultOptions) {
  return {
    duration_ms: 1,
    duration_api_ms: 1,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: options.costUsd ?? 0.25,
    usage: USAGE,
    modelUsage: {},
    permission_denials: [],
    uuid: nextUuid(),
    session_id: SESSION_ID,
    ...(options.terminalReason === undefined ? {} : { terminal_reason: options.terminalReason }),
  };
}

export function resultMessage(options: ResultOptions = {}): SDKResultMessage {
  const base = resultBase(options);
  if (options.errorSubtype !== undefined) {
    return { type: "result", subtype: options.errorSubtype, is_error: true, errors: options.errors ?? [], ...base };
  }
  return { type: "result", subtype: "success", is_error: options.isError ?? false, result: options.result ?? "done", ...base };
}
