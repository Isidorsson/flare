import { ONE_SHOT_APP_TIMEOUT_MS } from "@flare/protocol";

import { subscribeAgentEvents } from "./agent-events";
import type { OneShotClientDeps } from "./one-shot-client";
import { agentStore } from "./use-agent";

export const oneShotClientDeps: OneShotClientDeps = {
  send: (message) => agentStore.getState().sendStandalone(message),
  subscribe: subscribeAgentEvents,
  createId: () => crypto.randomUUID(),
  timeoutMs: ONE_SHOT_APP_TIMEOUT_MS,
};
