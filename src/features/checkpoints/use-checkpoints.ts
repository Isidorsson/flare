import { useStore } from "zustand";

import { selectIsBusy } from "@/features/agent/agent-selectors";
import { useAgent } from "@/features/agent/use-agent";

import { tauriCheckpointGateway } from "./checkpoint-gateway";
import { createCheckpointStore, type CheckpointState } from "./checkpoint-store";
import { restoreBlockedReason } from "./selectors";

export const checkpointStore = createCheckpointStore({
  gateway: tauriCheckpointGateway,
  now: () => Date.now(),
  createId: () => crypto.randomUUID(),
});

export function useCheckpoints<T>(selector: (state: CheckpointState) => T): T {
  return useStore(checkpointStore, selector);
}

/** Why undoing is not possible right now (the agent is working, another restore is running), or null. */
export function useRestoreBlockedReason(): string | null {
  const agentBusy = useAgent(selectIsBusy);
  const restoring = useCheckpoints((state) => state.restoring);
  const confirming = useCheckpoints((state) => state.pending !== null);
  return restoreBlockedReason({ agentBusy, restoring, confirming });
}
