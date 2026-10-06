import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useId } from "react";

import { ChatButton } from "@/features/chat/ChatButton";

import type { PendingRestore } from "./checkpoint-types";
import { PlannedFileList } from "./PlannedFileList";
import { conflictCount, pluralFiles, restoreConfirmLabel, restoreSummary, restoreTitle } from "./restore-labels";
import { useCheckpoints } from "./use-checkpoints";

// Runs when the dialog mounts; a dialog that is already open throws if asked to open again.
function openAsModal(dialog: HTMLDialogElement | null) {
  if (dialog !== null && !dialog.open) dialog.showModal();
}

function ConflictWarning({ count }: { count: number }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-surface-1 px-2.5 py-2 text-xs text-fg">
      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <span>
        {pluralFiles(count)} changed after this turn. Continuing replaces {count === 1 ? "that edit" : "those edits"}{" "}
        with the older content. A safety copy is kept, so you can redo it.
      </span>
    </p>
  );
}

function PendingDialog({ pending }: { pending: PendingRestore }) {
  const titleId = useId();
  const confirm = useCheckpoints((state) => state.confirmRestore);
  const cancel = useCheckpoints((state) => state.cancelRestore);
  const { target, status, files } = pending;
  const conflicts = conflictCount(files);

  return (
    <dialog
      ref={openAsModal}
      aria-labelledby={titleId}
      onClose={cancel}
      onCancel={(event) => {
        if (status === "restoring") event.preventDefault();
      }}
      className="m-auto w-[30rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border-strong bg-surface-2 p-0 text-fg shadow-xl backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-3 p-4">
        <h2 id={titleId} className="text-sm font-medium">
          {restoreTitle(target.request)}
        </h2>
        <p className="text-xs text-fg-muted">{restoreSummary(target.request)}</p>
        {status === "planning" ? (
          <p className="flex items-center gap-2 text-xs text-fg-muted">
            <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
            Checking which files would change
          </p>
        ) : (
          <PlannedFileList files={files} />
        )}
        {conflicts > 0 && <ConflictWarning count={conflicts} />}
        <div className="flex justify-end gap-2">
          <ChatButton autoFocus disabled={status === "restoring"} onClick={cancel}>
            Cancel
          </ChatButton>
          <ChatButton variant="primary" disabled={status !== "ready"} onClick={confirm}>
            {status === "restoring" ? "Restoring" : restoreConfirmLabel(target.request, conflicts)}
          </ChatButton>
        </div>
      </div>
    </dialog>
  );
}

/** Asks before any restore: lists the files that will change and which of them were edited since. */
export function UndoDialog() {
  const pending = useCheckpoints((state) => state.pending);
  return pending === null ? null : <PendingDialog pending={pending} />;
}
