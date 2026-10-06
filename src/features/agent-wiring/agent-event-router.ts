import type { BridgeEvent, BridgeEventOf } from "@flare/protocol";

import type { AgentFileChange, AgentFileEditing, AgentFileRead } from "@/features/files";

export interface AgentEventSinks {
  startTurn: (turnId: string) => void;
  endTurn: () => void;
  applyFileChange: (change: AgentFileChange) => void;
  noteFileRead: (read: AgentFileRead) => void;
  noteFileEditing: (editing: AgentFileEditing) => void;
  endFileEditing: (toolUseId: string) => void;
}

function toRead(event: BridgeEventOf<"file.read">): AgentFileRead {
  return {
    path: event.path,
    range: event.range ?? null,
    pattern: event.pattern ?? null,
    matchLines: event.matchLines ?? null,
  };
}

function toEditing(event: BridgeEventOf<"file.editing">): AgentFileEditing {
  return {
    toolUseId: event.toolUseId,
    path: event.path,
    kind: event.kind,
    oldString: event.oldString ?? null,
    text: event.text,
  };
}

function toChange(event: BridgeEventOf<"file.change">, turnId: string): AgentFileChange {
  return {
    turnId,
    toolUseId: event.toolUseId,
    path: event.path,
    kind: event.kind,
    before: event.before,
    after: event.after,
  };
}

/** Routes bridge events to the panels that react to agent activity, tagging file changes with a turn. */
export function createAgentEventRouter(sinks: AgentEventSinks): (event: BridgeEvent) => void {
  let turn = 0;
  return (event) => {
    switch (event.type) {
      case "turn.started":
        turn += 1;
        sinks.startTurn(`turn-${String(turn)}`);
        return;
      case "turn.completed":
        sinks.endTurn();
        return;
      case "error":
        if (event.fatal === true) sinks.endTurn();
        return;
      case "tool.finished":
        sinks.endFileEditing(event.toolUseId);
        return;
      case "file.editing":
        sinks.noteFileEditing(toEditing(event));
        return;
      case "file.change":
        sinks.applyFileChange(toChange(event, `turn-${String(turn)}`));
        return;
      case "file.read":
        sinks.noteFileRead(toRead(event));
        return;
      default:
        return;
    }
  };
}
