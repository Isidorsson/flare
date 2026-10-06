import { subscribeAgentEvents } from "@/features/agent/agent-events";
import {
  applyAgentFileChange,
  endAgentFileEditing,
  endAgentTurn,
  noteAgentFileEditing,
  noteAgentFileRead,
  startAgentTurn,
} from "@/features/files";
import { recordAgentActivity, setAgentStatus, startTurn } from "@/features/graph";

import { createAgentEventRouter } from "./agent-event-router";
import { createGraphActivityRouter } from "./graph-activity-router";
import { wireCheckpoints } from "./wire-checkpoints";

export function wireAgentEvents(): () => void {
  const unsubscribeGraph = subscribeAgentEvents(
    createGraphActivityRouter({ recordActivity: recordAgentActivity, setStatus: setAgentStatus, startTurn }),
  );
  const unsubscribeFiles = subscribeAgentEvents(
    createAgentEventRouter({
      startTurn: startAgentTurn,
      endTurn: endAgentTurn,
      applyFileChange: applyAgentFileChange,
      noteFileRead: noteAgentFileRead,
      noteFileEditing: noteAgentFileEditing,
      endFileEditing: endAgentFileEditing,
    }),
  );
  const unsubscribeCheckpoints = wireCheckpoints();
  return () => {
    unsubscribeGraph();
    unsubscribeFiles();
    unsubscribeCheckpoints();
  };
}
