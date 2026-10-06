import { Undo2 } from "lucide-react";

import { useAgent } from "@/features/agent/use-agent";
import { IconButton } from "@/shared/ui/IconButton";

import type { TurnRecord } from "./checkpoint-types";
import { isUndoable, latestRecord, targetOf } from "./selectors";
import { useCheckpoints, useRestoreBlockedReason } from "./use-checkpoints";

function unavailableReason(record: TurnRecord): string | null {
  if (record.status === "open" || record.status === "closing") return "Available once this turn finishes";
  return isUndoable(record) ? null : "This turn changed no files";
}

/** Undo for the newest turn of the open thread, for the strip that lists what the turn changed. */
export function LatestTurnUndo() {
  const threadId = useAgent((state) => state.activeThreadId);
  const record = useCheckpoints((state) => (threadId === null ? undefined : latestRecord(state.records, threadId)));
  const requestRestore = useCheckpoints((state) => state.requestRestore);
  const blockedReason = useRestoreBlockedReason();
  if (record === undefined || record.status === "failed") return null;

  return (
    <IconButton
      icon={Undo2}
      label="Undo this turn"
      side="bottom"
      disabledReason={unavailableReason(record) ?? blockedReason ?? undefined}
      onClick={() => {
        if (isUndoable(record)) requestRestore(targetOf(record, "undoTurn"));
      }}
    />
  );
}
