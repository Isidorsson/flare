import { useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";

interface DeleteBranchDialogProps {
  name: string;
  onConfirm: (force: boolean) => void;
  onCancel: () => void;
}

export function DeleteBranchDialog({ name, onConfirm, onCancel }: DeleteBranchDialogProps) {
  const [force, setForce] = useState(false);
  return (
    <ConfirmDialog
      title={`Delete branch ${name}?`}
      confirmLabel="Delete branch"
      danger
      onConfirm={() => {
        onConfirm(force);
      }}
      onCancel={onCancel}
    >
      <p className="text-xs text-fg-muted">
        Removes the local branch only. Git refuses when it holds commits that no other branch has, unless you force it.
      </p>
      <label className="flex items-center gap-2 text-xs text-fg">
        <input
          type="checkbox"
          checked={force}
          onChange={(event) => {
            setForce(event.target.checked);
          }}
          className="accent-accent"
        />
        Delete even if it is not fully merged
      </label>
    </ConfirmDialog>
  );
}
