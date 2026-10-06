import { TriangleAlert } from "lucide-react";

import { Tooltip } from "@/shared/ui/Tooltip";

import { pluralFiles } from "./restore-labels";
import { isUndoable, recordForAnchor, targetOf } from "./selectors";
import { UndoButton } from "./UndoButton";
import { useCheckpoints, useRestoreBlockedReason } from "./use-checkpoints";

interface TurnFooterProps {
  threadId: string;
  /** The user message that opened the turn. */
  anchorItemId: string;
}

/** What a finished turn changed, with the action to undo it. Nothing renders for a turn that changed no files. */
export function TurnFooter({ threadId, anchorItemId }: TurnFooterProps) {
  const record = useCheckpoints((state) => recordForAnchor(state.records, threadId, anchorItemId));
  const requestRestore = useCheckpoints((state) => state.requestRestore);
  const blockedReason = useRestoreBlockedReason();
  if (record === undefined || !isUndoable(record)) return null;

  return (
    <div role="group" aria-label="Changes made in this turn" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
      <span>
        {pluralFiles(record.files.length)} changed <span className="text-success">+{record.added}</span>{" "}
        <span className="text-danger">−{record.removed}</span>
      </span>
      {record.warnings.length > 0 && (
        <Tooltip content="Some files are not covered by undo" detail={record.warnings.join("\n")} side="top">
          <span tabIndex={0} className="inline-flex items-center gap-1 text-warning">
            <TriangleAlert aria-hidden className="size-3.5" />
            {pluralFiles(record.warnings.length)} skipped
          </span>
        </Tooltip>
      )}
      <UndoButton
        blockedReason={blockedReason}
        onPress={() => {
          requestRestore(targetOf(record, "undoTurn"));
        }}
      />
    </div>
  );
}
