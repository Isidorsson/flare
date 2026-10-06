import type { BridgeEvent, BridgeEventOf, PermissionDecision } from "@flare/protocol";

import type { ChatItem, Thread, ToolItem, TouchedFile } from "./thread-types";

export const TITLE_MAX_CHARS = 60;

type ToolEvent = BridgeEventOf<"tool.started" | "tool.finished" | "file.read" | "file.change" | "permission.request">;

export function applyBridgeEvent(thread: Thread, event: BridgeEvent): Thread {
  return isToolEvent(event) ? applyToolEvent(thread, event) : applyConversationEvent(thread, event);
}

function isToolEvent(event: BridgeEvent): event is ToolEvent {
  return (
    event.type === "tool.started" ||
    event.type === "tool.finished" ||
    event.type === "file.read" ||
    event.type === "file.change" ||
    event.type === "permission.request"
  );
}

function applyToolEvent(thread: Thread, event: ToolEvent): Thread {
  switch (event.type) {
    case "tool.started":
      return startTool(thread, event);
    case "tool.finished":
      return finishTool(thread, event);
    case "file.read":
      return touchFile(thread, event.toolUseId, { path: event.path, action: "read" });
    case "file.change":
      return touchFile(thread, event.toolUseId, { path: event.path, action: event.kind });
    case "permission.request":
      return requestPermission(thread, event);
  }
}

function applyConversationEvent(thread: Thread, event: Exclude<BridgeEvent, ToolEvent>): Thread {
  switch (event.type) {
    case "session.ready":
      return { ...thread, sessionId: event.sessionId };
    case "session.outputStyles":
      return thread;
    case "assistant.delta":
      return appendDelta(thread, event.text);
    case "assistant.message":
      return finishAssistantMessage(thread, event);
    case "turn.completed":
      return completeTurn(thread, event);
    case "error":
      return reportError(thread, event);
  }
}

export function addUserMessage(thread: Thread, text: string): Thread {
  const next = pushItem(thread, (id) => ({ kind: "user", id, text }));
  return { ...next, status: "running", title: thread.title || titleFrom(text) };
}

export function addNotice(thread: Thread, text: string): Thread {
  return pushItem(thread, (id) => ({ kind: "notice", id, text }));
}

export function markPermission(thread: Thread, requestId: string, decision: PermissionDecision): Thread {
  return mapItems(thread, (item) =>
    item.kind === "permission" && item.id === requestId && item.status === "pending"
      ? { ...item, status: decision }
      : item,
  );
}

export function stopRunning(thread: Thread): Thread {
  return { ...settleItems(thread), status: "idle" };
}

function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= TITLE_MAX_CHARS ? oneLine : `${oneLine.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

function appendDelta(thread: Thread, text: string): Thread {
  const last = thread.items.at(-1);
  if (last?.kind === "assistant" && last.streaming) {
    return { ...thread, items: [...thread.items.slice(0, -1), { ...last, text: last.text + text }] };
  }
  return pushItem(thread, (id) => ({ kind: "assistant", id, text, streaming: true }));
}

function finishAssistantMessage(thread: Thread, event: BridgeEventOf<"assistant.message">): Thread {
  const last = thread.items.at(-1);
  if (last?.kind === "assistant" && last.streaming) {
    const finished: ChatItem = { ...last, text: event.text, streaming: false };
    return { ...thread, items: [...thread.items.slice(0, -1), finished] };
  }
  return { ...thread, items: [...thread.items, { kind: "assistant", id: event.id, text: event.text, streaming: false }] };
}

function startTool(thread: Thread, event: BridgeEventOf<"tool.started">): Thread {
  const tool: ToolItem = {
    kind: "tool",
    id: event.toolUseId,
    name: event.name,
    input: event.input,
    status: "running",
    summary: "",
    touched: [],
  };
  return { ...thread, items: [...closeStreaming(thread.items), tool] };
}

function finishTool(thread: Thread, event: BridgeEventOf<"tool.finished">): Thread {
  return mapItems(thread, (item) =>
    item.kind === "tool" && item.id === event.toolUseId
      ? { ...item, status: event.isError ? "error" : "done", summary: event.summary }
      : item,
  );
}

function touchFile(thread: Thread, toolUseId: string, file: TouchedFile): Thread {
  return mapItems(thread, (item) => {
    if (item.kind !== "tool" || item.id !== toolUseId) return item;
    const already = item.touched.some((known) => known.path === file.path && known.action === file.action);
    return already ? item : { ...item, touched: [...item.touched, file] };
  });
}

function requestPermission(thread: Thread, event: BridgeEventOf<"permission.request">): Thread {
  const request: ChatItem = {
    kind: "permission",
    id: event.requestId,
    toolName: event.toolName,
    input: event.input,
    status: "pending",
  };
  return { ...thread, items: [...closeStreaming(thread.items), request] };
}

function completeTurn(thread: Thread, event: BridgeEventOf<"turn.completed">): Thread {
  return { ...stopRunning(thread), costUsd: event.costUsd, usage: event.usage };
}

function reportError(thread: Thread, event: BridgeEventOf<"error">): Thread {
  const withNotice = addNotice(thread, event.message);
  return event.fatal === true ? stopRunning(withNotice) : withNotice;
}

function settleItems(thread: Thread): Thread {
  return {
    ...thread,
    items: closeStreaming(thread.items).map((item): ChatItem => {
      if (item.kind === "permission" && item.status === "pending") return { ...item, status: "expired" };
      if (item.kind === "tool" && item.status === "running") {
        return { ...item, status: "error", summary: item.summary || "Stopped before finishing" };
      }
      return item;
    }),
  };
}

function closeStreaming(items: ChatItem[]): ChatItem[] {
  return items.map((item) => (item.kind === "assistant" && item.streaming ? { ...item, streaming: false } : item));
}

function mapItems(thread: Thread, update: (item: ChatItem) => ChatItem): Thread {
  return { ...thread, items: thread.items.map(update) };
}

function pushItem(thread: Thread, build: (id: string) => ChatItem): Thread {
  const id = `item-${thread.nextSeq}`;
  return { ...thread, items: [...thread.items, build(id)], nextSeq: thread.nextSeq + 1 };
}
