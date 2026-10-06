import { Undo2 } from "lucide-react";
import type { MouseEvent } from "react";

import { Tooltip } from "@/shared/ui/Tooltip";

interface UndoButtonProps {
  /** Why it cannot be pressed now. It stays focusable so the tooltip can say so. */
  blockedReason: string | null;
  onPress: () => void;
}

function ignoreClick(event: MouseEvent) {
  event.preventDefault();
}

/** "Undo" with its icon, for the end of a turn in the transcript. */
export function UndoButton({ blockedReason, onPress }: UndoButtonProps) {
  const blocked = blockedReason !== null;
  return (
    <Tooltip
      content="Undo this turn"
      detail={blockedReason ?? "Puts back the files this turn changed and leaves everything else alone. You can redo it."}
      side="top"
    >
      <button
        type="button"
        aria-disabled={blocked || undefined}
        onClick={blocked ? ignoreClick : onPress}
        className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-fg-muted transition-colors ${
          blocked ? "opacity-40" : "hover:bg-surface-3 hover:text-fg"
        }`}
      >
        <Undo2 aria-hidden className="size-3.5" />
        Undo turn
      </button>
    </Tooltip>
  );
}
