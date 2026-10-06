import { subscribeAgentEvents } from "@/features/agent/agent-events";
import { selectLiveThread } from "@/features/agent/agent-selectors";
import { agentStore } from "@/features/agent/use-agent";
import { endCheckpointTurn, pruneCheckpoints, startCheckpointTurn } from "@/features/checkpoints";
import { workspaceStore } from "@/features/workspace/use-workspace";

import { createCheckpointRouter } from "./checkpoint-router";
import { createTurnStatusWatcher } from "./turn-status-watcher";

function pruneWhenWorkspaceOpens(): () => void {
  const { root } = workspaceStore.getState();
  if (root !== null) pruneCheckpoints(root);
  return workspaceStore.subscribe((state, previous) => {
    if (state.root !== null && state.root !== previous.root) pruneCheckpoints(state.root);
  });
}

/**
 * Snapshots the workspace around every agent turn. Two triggers start a turn: the thread turning
 * "running" when a message is sent (early enough to beat the agent's first edit) and the bridge's
 * `turn.started` (for turns nobody sent a message for); a turn already being recorded is kept.
 */
export function wireCheckpoints(): () => void {
  const unsubscribeStatus = agentStore.subscribe(
    createTurnStatusWatcher({ turnStarted: startCheckpointTurn, turnEnded: endCheckpointTurn }),
  );
  const unsubscribeEvents = subscribeAgentEvents(
    createCheckpointRouter({
      turnStarted: () => {
        startCheckpointTurn(selectLiveThread(agentStore.getState()));
      },
      turnEnded: endCheckpointTurn,
    }),
  );
  const unsubscribePrune = pruneWhenWorkspaceOpens();
  return () => {
    unsubscribeStatus();
    unsubscribeEvents();
    unsubscribePrune();
  };
}
