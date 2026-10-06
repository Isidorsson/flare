import type { BridgeEvent } from "@flare/protocol";

import type { AgentFileChange } from "@/features/files/files-types";

export interface AgentEventSinks {
  applyFileChange: (change: AgentFileChange) => void;
  noteFileRead: (path: string) => void;
}

/** Routes bridge events to the panels that react to agent activity, tagging file changes with a turn. */
export function createAgentEventRouter(sinks: AgentEventSinks): (event: BridgeEvent) => void {
  let turn = 1;
  return (event) => {
    switch (event.type) {
      case "turn.completed":
        turn += 1;
        return;
      case "file.change":
        sinks.applyFileChange({
          turnId: `turn-${String(turn)}`,
          toolUseId: event.toolUseId,
          path: event.path,
          kind: event.kind,
          before: event.before,
          after: event.after,
        });
        return;
      case "file.read":
        sinks.noteFileRead(event.path);
        return;
      default:
        return;
    }
  };
}
