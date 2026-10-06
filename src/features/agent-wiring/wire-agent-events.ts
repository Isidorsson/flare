import { subscribeAgentEvents } from "@/features/agent/agent-events";
import {
  applyAgentFileChange,
  endAgentFileEditing,
  endAgentTurn,
  noteAgentFileEditing,
  noteAgentFileRead,
  startAgentTurn,
} from "@/features/files";
import { pulse } from "@/features/graph";

import { createAgentEventRouter } from "./agent-event-router";

export function wireAgentEvents(): () => void {
  return subscribeAgentEvents(
    createAgentEventRouter({
      startTurn: startAgentTurn,
      endTurn: endAgentTurn,
      applyFileChange: applyAgentFileChange,
      noteFileRead: noteAgentFileRead,
      noteFileEditing: noteAgentFileEditing,
      endFileEditing: endAgentFileEditing,
      pulse,
    }),
  );
}
