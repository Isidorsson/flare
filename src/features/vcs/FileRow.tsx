import { Minus, Plus, Undo2 } from "lucide-react";

import { IconButton } from "@/shared/ui/IconButton";
import { Tooltip } from "@/shared/ui/Tooltip";

import { CHANGE_LABELS, CHANGE_LETTERS, CHANGE_TONES, splitPath } from "./change-labels";
import { discardBlockedReason } from "./change-groups";
import type { ChangeRow } from "./vcs-types";

export interface FileRowProps {
  row: ChangeRow;
  selected: boolean;
  /** Why no git action can start now (another one is running), or null. */
  blockedReason: string | null;
  onSelect: (row: ChangeRow) => void;
  /** Stages a row of Changes, unstages a row of Staged. */
  onToggle: (row: ChangeRow) => void;
  onDiscard: (row: ChangeRow) => void;
}

function describe(row: ChangeRow): string {
  const label = CHANGE_LABELS[row.change];
  return row.origPath === null ? label : `${label} from ${row.origPath}`;
}

function RowActions({ row, blockedReason, onToggle, onDiscard }: Omit<FileRowProps, "selected" | "onSelect">) {
  return (
    <>
      {row.staged ? null : (
        <IconButton
          icon={Undo2}
          label="Discard changes"
          detail="Puts the file back to its staged or committed version. Asks first"
          disabledReason={blockedReason ?? discardBlockedReason(row.change) ?? undefined}
          className="size-6"
          onClick={() => {
            onDiscard(row);
          }}
        />
      )}
      <IconButton
        icon={row.staged ? Minus : Plus}
        label={row.staged ? "Unstage" : "Stage"}
        detail={row.staged ? "Takes the file out of the next commit" : "Adds the file to the next commit"}
        disabledReason={blockedReason ?? undefined}
        className="size-6"
        onClick={() => {
          onToggle(row);
        }}
      />
    </>
  );
}

export function FileRow({ row, selected, blockedReason, onSelect, onToggle, onDiscard }: FileRowProps) {
  const { name, dir } = splitPath(row.path);
  const actionsVisible = selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";
  return (
    <li className={`group flex h-7 items-center gap-1 pr-1 pl-2 ${selected ? "bg-surface-3" : "hover:bg-surface-2"}`}>
      <Tooltip content={row.path} detail={describe(row)} side="right">
        <button
          type="button"
          aria-current={selected || undefined}
          onClick={() => {
            onSelect(row);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
        >
          <span
            aria-hidden
            className={`w-3 shrink-0 text-center font-mono text-[11px] font-semibold ${CHANGE_TONES[row.change]}`}
          >
            {CHANGE_LETTERS[row.change]}
          </span>
          <span className="truncate text-fg">{name}</span>
          <span className="min-w-0 shrink-[8] truncate text-fg-subtle">{dir}</span>
          <span className="sr-only">{describe(row)}</span>
        </button>
      </Tooltip>
      <span className={`flex shrink-0 items-center ${actionsVisible}`}>
        <RowActions row={row} blockedReason={blockedReason} onToggle={onToggle} onDiscard={onDiscard} />
      </span>
    </li>
  );
}
