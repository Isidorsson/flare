import { useId, type ReactNode } from "react";

import { ChatButton } from "@/features/chat/ChatButton";

interface ConfirmDialogProps {
  title: string;
  confirmLabel: string;
  /** The action destroys something: the confirm button is styled as a warning. Cancel always has the focus. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}

// Runs when the dialog mounts; a dialog that is already open throws if asked to open again.
function openAsModal(dialog: HTMLDialogElement | null) {
  if (dialog !== null && !dialog.open) dialog.showModal();
}

/** Asks before something that cannot be taken back. Render it only while the question is open. */
export function ConfirmDialog({ title, confirmLabel, danger = false, onConfirm, onCancel, children }: ConfirmDialogProps) {
  const titleId = useId();
  return (
    <dialog
      ref={openAsModal}
      aria-labelledby={titleId}
      onClose={onCancel}
      className="m-auto w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border-strong bg-surface-2 p-0 text-fg shadow-xl backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-3 p-4 select-text">
        <h2 id={titleId} className="text-sm font-medium">
          {title}
        </h2>
        {children}
        <div className="flex justify-end gap-2">
          <ChatButton autoFocus onClick={onCancel}>
            Cancel
          </ChatButton>
          <ChatButton variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </ChatButton>
        </div>
      </div>
    </dialog>
  );
}
