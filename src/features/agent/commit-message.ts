import { COMMIT_MESSAGE_APP_TIMEOUT_MS } from "@flare/protocol";

import { subscribeAgentEvents } from "./agent-events";
import { createCommitMessageClient } from "./commit-message-client";
import { agentStore } from "./use-agent";

export type { CommitMessage, CommitMessageInput, GenerateCommitMessage } from "./commit-message-client";

export const generateCommitMessage = createCommitMessageClient({
  send: (message) => agentStore.getState().sendStandalone(message),
  subscribe: subscribeAgentEvents,
  createId: () => crypto.randomUUID(),
  timeoutMs: COMMIT_MESSAGE_APP_TIMEOUT_MS,
});
