import { subscribeAgentEvents } from "@/features/agent/agent-events";
import { applyAgentFileChange, noteAgentFileRead } from "@/features/files";
import { pulse } from "@/features/graph";

import { createAgentEventRouter } from "./agent-event-router";

export function wireAgentEvents(): () => void {
  return subscribeAgentEvents(
    createAgentEventRouter({
      applyFileChange: applyAgentFileChange,
      noteFileRead: (path) => {
        noteAgentFileRead(path).catch((error: unknown) => {
          console.error("flare: following an agent file read failed", error);
        });
      },
      pulse,
    }),
  );
}
