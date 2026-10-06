import { History, RotateCcw, Undo2 } from "lucide-react";
import { useId, useMemo, useRef } from "react";

import type { ChatItem } from "@/features/agent/thread-types";
import { anchorNameFor } from "@/shared/ui/anchor-name";
import { IconButton } from "@/shared/ui/IconButton";

import { formatClock, oneLine } from "./format";
import { pluralFiles } from "./restore-labels";
import { targetOf, undoableTurns, type UndoableTurn } from "./selectors";
import { useCheckpoints, useRestoreBlockedReason } from "./use-checkpoints";

interface CheckpointsMenuProps {
  threadId: string | null;
  /** The thread's chat items, to show what was asked in each turn. */
  items: readonly ChatItem[];
}

interface RowProps {
  record: UndoableTurn;
  prompt: string;
  blockedReason: string | null;
  onRestore: (record: UndoableTurn, kind: "undoTurn" | "restoreBefore") => void;
}

function promptOf(items: readonly ChatItem[], record: UndoableTurn): string {
  const anchor = items.find((item) => item.id === record.anchorItemId);
  return anchor?.kind === "user" ? oneLine(anchor.text) : `Turn ${String(record.turn)}`;
}

function Row({ record, prompt, blockedReason, onRestore }: RowProps) {
  return (
    <li className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-fg">{prompt}</p>
        <p className="text-[11px] text-fg-muted">
          {formatClock(record.startedAt)} · {pluralFiles(record.files.length)}{" "}
          <span className="text-success">+{record.added}</span> <span className="text-danger">−{record.removed}</span>
        </p>
      </div>
      <IconButton
        icon={Undo2}
        label="Undo only this turn"
        side="left"
        disabledReason={blockedReason ?? undefined}
        onClick={() => {
          onRestore(record, "undoTurn");
        }}
      />
      <IconButton
        icon={RotateCcw}
        label="Roll back to before this turn"
        side="left"
        disabledReason={blockedReason ?? undefined}
        onClick={() => {
          onRestore(record, "restoreBefore");
        }}
      />
    </li>
  );
}

/** Lists the turns of the open thread that changed files, to undo one or to roll back to before one. */
export function CheckpointsMenu({ threadId, items }: CheckpointsMenuProps) {
  const menuId = useId();
  const anchor = anchorNameFor("checkpoints-menu", menuId);
  const popover = useRef<HTMLDivElement>(null);
  const records = useCheckpoints((state) => state.records);
  const requestRestore = useCheckpoints((state) => state.requestRestore);
  const blockedReason = useRestoreBlockedReason();
  const turns = useMemo(() => (threadId === null ? [] : undoableTurns(records, threadId)), [records, threadId]);

  const restore = (record: UndoableTurn, kind: "undoTurn" | "restoreBefore") => {
    popover.current?.hidePopover();
    requestRestore(targetOf(record, kind));
  };

  return (
    <>
      <IconButton
        icon={History}
        label="Checkpoints"
        side="bottom"
        disabledReason={turns.length === 0 ? "No turns have changed files yet" : undefined}
        popoverTarget={menuId}
        style={{ anchorName: anchor }}
      />
      <div
        id={menuId}
        ref={popover}
        popover="auto"
        aria-label="Checkpoints"
        style={{ positionAnchor: anchor, positionArea: "bottom span-left" }}
        className="inset-auto m-0 mt-1 w-80 rounded-lg border border-border-strong bg-surface-2 p-1 shadow-lg"
      >
        <p className="px-2 py-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">Before each turn</p>
        <ul className="max-h-80 overflow-y-auto">
          {turns.map((record) => (
            <Row
              key={record.id}
              record={record}
              prompt={promptOf(items, record)}
              blockedReason={blockedReason}
              onRestore={restore}
            />
          ))}
        </ul>
      </div>
    </>
  );
}
