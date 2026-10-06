import type { Thread } from "@/features/agent/thread-types";

import { checkpointStore } from "./use-checkpoints";
import { turnContextFor } from "./turn-context";

/**
 * Snapshots the workspace before the agent changes anything. Called as soon as a message is sent,
 * and again on `turn.started` for turns nobody sent a message for; a turn already recorded is kept.
 */
export function startCheckpointTurn(thread: Thread | null): void {
  const context = turnContextFor(thread);
  const store = checkpointStore.getState();
  if (context.ok) store.startTurn(context.context);
  else store.reportUnavailable(context.reason);
}

/** Wire to `turn.completed`, to a session dying mid-turn and to the thread going idle: snapshots again and lists what changed. */
export function endCheckpointTurn(): void {
  checkpointStore.getState().endTurn();
}

/** Drops checkpoints of long-quiet sessions in a workspace; once per workspace per run. */
export function pruneCheckpoints(root: string): void {
  checkpointStore.getState().pruneWorkspace(root);
}
