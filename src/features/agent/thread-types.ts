import type { FileChangeKind, PermissionDecision, ToolInput, Usage } from "@flare/protocol";

export type ToolStatus = "running" | "done" | "error";
export type PermissionStatus = "pending" | PermissionDecision | "expired";
export type TouchedAction = "read" | FileChangeKind;

export interface TouchedFile {
  path: string;
  action: TouchedAction;
}

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: ToolInput;
      status: ToolStatus;
      summary: string;
      touched: TouchedFile[];
    }
  | { kind: "permission"; id: string; toolName: string; input: ToolInput; status: PermissionStatus }
  | { kind: "notice"; id: string; text: string };

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;
export type PermissionItem = Extract<ChatItem, { kind: "permission" }>;
export type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;

export type ThreadStatus = "idle" | "running";

export interface Thread {
  id: string;
  sessionId: string | null;
  cwd: string;
  title: string;
  createdAt: number;
  status: ThreadStatus;
  costUsd: number;
  usage: Usage | null;
  items: ChatItem[];
  nextSeq: number;
}

export function createThread(params: { id: string; cwd: string; createdAt: number }): Thread {
  return {
    ...params,
    sessionId: null,
    title: "",
    status: "idle",
    costUsd: 0,
    usage: null,
    items: [],
    nextSeq: 0,
  };
}

export function threadTitle(thread: Thread | null): string {
  return thread === null || thread.title === "" ? "New thread" : thread.title;
}
