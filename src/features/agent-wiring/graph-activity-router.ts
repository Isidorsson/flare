import type { BridgeEvent, BridgeEventOf, ToolInput } from "@flare/protocol";

import type { ActivityInput, AgentStatus } from "@/features/graph";

export interface GraphActivitySinks {
  recordActivity: (activity: ActivityInput) => void;
  setStatus: (status: AgentStatus) => void;
  startTurn: () => void;
}

const SEARCH_TOOLS = new Set(["Grep", "Glob"]);
const RUN_TOOLS = new Set(["Bash", "PowerShell"]);
const DETAIL_MAX_CHARS = 48;

function stringField(input: ToolInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function clip(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  return firstLine.length > DETAIL_MAX_CHARS ? `${firstLine.slice(0, DETAIL_MAX_CHARS - 1)}…` : firstLine;
}

/** Search and shell tools touch no single file, so they only move the comet's label. */
function toolActivity(event: BridgeEventOf<"tool.started">): ActivityInput | null {
  if (SEARCH_TOOLS.has(event.name)) {
    const pattern = stringField(event.input, "pattern");
    return { kind: "search", detail: pattern === undefined ? undefined : clip(pattern) };
  }
  if (RUN_TOOLS.has(event.name)) {
    const command = stringField(event.input, "command");
    return { kind: "run", detail: command === undefined ? undefined : clip(command) };
  }
  return null;
}

/** Lines present on only one side; cheap and good enough to size a node's glow. */
export function countChangedLines(before: string | null, after: string): number {
  const afterLines = after.split("\n");
  if (before === null) return afterLines.length;
  const beforeLines = before.split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  const added = afterLines.filter((line) => !beforeSet.has(line)).length;
  const removed = beforeLines.filter((line) => !afterSet.has(line)).length;
  return added + removed;
}

function changeActivity(event: BridgeEventOf<"file.change">): ActivityInput {
  return {
    path: event.path,
    kind: event.kind === "create" ? "create" : "edit",
    linesChanged: countChangedLines(event.before, event.after),
  };
}

/** Translates bridge events into the code graph's activity, status and turn signals. */
export function createGraphActivityRouter(sinks: GraphActivitySinks): (event: BridgeEvent) => void {
  const streamingEdits = new Set<string>();
  let status: AgentStatus = "idle";
  const setStatus = (next: AgentStatus) => {
    if (next === status) return;
    status = next;
    sinks.setStatus(next);
  };

  const routeStatus = (event: BridgeEvent) => {
    switch (event.type) {
      case "turn.started":
        sinks.startTurn();
        setStatus("working");
        return;
      case "assistant.delta":
        setStatus("thinking");
        return;
      case "tool.started":
        setStatus("working");
        return;
      case "turn.completed":
        streamingEdits.clear();
        setStatus("done");
        return;
      case "error":
        if (event.fatal === true) setStatus("idle");
        return;
      default:
        return;
    }
  };

  const activityOf = (event: BridgeEvent): ActivityInput | null => {
    switch (event.type) {
      case "tool.started":
        return toolActivity(event);
      case "file.read":
        return { path: event.path, kind: "read" };
      case "file.editing":
        if (streamingEdits.has(event.toolUseId)) return null;
        streamingEdits.add(event.toolUseId);
        return { path: event.path, kind: "edit" };
      case "file.change":
        streamingEdits.delete(event.toolUseId);
        return changeActivity(event);
      default:
        return null;
    }
  };

  return (event) => {
    routeStatus(event);
    const activity = activityOf(event);
    if (activity !== null) sinks.recordActivity(activity);
  };
}
