import type { AgentSnapshot } from "@/features/agent/agent-controller";
import type { Thread } from "@/features/agent/thread-types";

export interface TurnStatusSinks {
  turnStarted: (thread: Thread) => void;
  turnEnded: () => void;
}

function runningIds(threads: readonly Thread[]): Set<string> {
  return new Set(threads.filter((thread) => thread.status === "running").map((thread) => thread.id));
}

/**
 * Reacts to threads starting and stopping work. A thread turns "running" the moment a message is
 * sent, seconds before the bridge reports `turn.started`, which makes it the earliest point at which
 * the workspace can be snapshotted; it turns idle when the turn completes, fails or is cut off, so
 * it also covers turns that end without a `turn.completed`.
 */
export function createTurnStatusWatcher(sinks: TurnStatusSinks): (state: AgentSnapshot, previous: AgentSnapshot) => void {
  return (state, previous) => {
    if (state.threads === previous.threads) return;
    const before = runningIds(previous.threads);
    const now = runningIds(state.threads);
    for (const thread of state.threads) {
      if (now.has(thread.id) && !before.has(thread.id)) sinks.turnStarted(thread);
    }
    if ([...before].some((id) => !now.has(id))) sinks.turnEnded();
  };
}
