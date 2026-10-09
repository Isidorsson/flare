import { Minus, Plus, Undo2 } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/shared/ui/IconButton";

import { discardPaths, groupFiles, stagePaths, unstagePaths } from "./change-groups";
import { DiscardDialog } from "./DiscardDialog";
import { FileRow } from "./FileRow";
import { InlineError } from "./InlineError";
import { useVcs } from "./use-vcs";
import type { VcsStatus } from "./vcs-schemas";
import { actionBlockedReason } from "./vcs-selectors";
import type { ChangeRow, VcsAction } from "./vcs-types";

/** Rows past this need a click: every row carries tooltips, which makes a list of thousands slow. */
const VISIBLE_ROWS = 300;

const FILE_ERRORS: readonly VcsAction[] = ["stage", "unstage", "discard"];

interface HeaderProps {
  title: string;
  staged: boolean;
  rows: readonly ChangeRow[];
  blockedReason: string | null;
  onDiscardAll: () => void;
}

function SectionHeader({ title, staged, rows, blockedReason, onDiscardAll }: HeaderProps) {
  const stageAll = useVcs((state) => state.stageAll);
  const unstageAll = useVcs((state) => state.unstageAll);
  const nothingToDiscard = discardPaths(rows).length === 0;
  return (
    <div className="flex h-7 items-center justify-between pr-1 pl-3">
      <h3 className="text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
        {title} <span className="ml-1 rounded-full bg-surface-3 px-1.5 text-fg-muted">{rows.length}</span>
      </h3>
      <div className="flex items-center">
        {staged ? null : (
          <IconButton
            icon={Undo2}
            label="Discard all changes"
            detail="Puts every tracked file back to its staged or committed version. Asks first"
            disabledReason={blockedReason ?? (nothingToDiscard ? "Untracked files cannot be discarded" : undefined)}
            className="size-6"
            onClick={onDiscardAll}
          />
        )}
        <IconButton
          icon={staged ? Minus : Plus}
          label={staged ? "Unstage all" : "Stage all"}
          detail={staged ? "Takes every file out of the next commit" : "Adds every changed file to the next commit"}
          disabledReason={blockedReason ?? undefined}
          className="size-6"
          onClick={() => {
            void (staged ? unstageAll() : stageAll());
          }}
        />
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  staged: boolean;
  rows: readonly ChangeRow[];
}

interface FileRowsProps {
  staged: boolean;
  rows: readonly ChangeRow[];
  onDiscard: (paths: string[]) => void;
}

function FileRows({ staged, rows, onDiscard }: FileRowsProps) {
  const selection = useVcs((state) => state.selection);
  const blockedReason = useVcs(actionBlockedReason);
  const selectFile = useVcs((state) => state.selectFile);
  const stage = useVcs((state) => state.stage);
  const unstage = useVcs((state) => state.unstage);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, VISIBLE_ROWS);

  return (
    <>
      <ul>
        {shown.map((row) => (
          <FileRow
            key={row.path}
            row={row}
            selected={selection?.path === row.path && selection.staged === staged}
            blockedReason={blockedReason}
            onSelect={(picked) => {
              void selectFile({ path: picked.path, staged });
            }}
            onToggle={(picked) => {
              void (staged ? unstage(unstagePaths([picked])) : stage(stagePaths([picked])));
            }}
            onDiscard={(picked) => {
              onDiscard([picked.path]);
            }}
          />
        ))}
      </ul>
      {shown.length < rows.length ? (
        <button
          type="button"
          onClick={() => {
            setShowAll(true);
          }}
          className="h-7 w-full px-3 text-left text-xs text-fg-muted hover:text-fg"
        >
          Show {rows.length - shown.length} more files
        </button>
      ) : null}
    </>
  );
}

function FileSection({ title, staged, rows }: SectionProps) {
  const blockedReason = useVcs(actionBlockedReason);
  const discard = useVcs((state) => state.discard);
  const [discarding, setDiscarding] = useState<string[] | null>(null);

  return (
    <section aria-label={title}>
      <SectionHeader
        title={title}
        staged={staged}
        rows={rows}
        blockedReason={blockedReason}
        onDiscardAll={() => {
          setDiscarding(discardPaths(rows));
        }}
      />
      <FileRows staged={staged} rows={rows} onDiscard={setDiscarding} />
      {discarding === null ? null : (
        <DiscardDialog
          paths={discarding}
          onCancel={() => {
            setDiscarding(null);
          }}
          onConfirm={() => {
            void discard(discarding);
            setDiscarding(null);
          }}
        />
      )}
    </section>
  );
}

/** The two lists of the working tree: what the next commit contains, and what it does not yet. */
export function FileSections({ status }: { status: VcsStatus }) {
  const { staged, unstaged } = groupFiles(status.files);
  return (
    <div className="pb-2">
      <InlineError actions={FILE_ERRORS} />
      {staged.length === 0 ? null : <FileSection title="Staged" staged rows={staged} />}
      {unstaged.length === 0 ? null : <FileSection title="Changes" staged={false} rows={unstaged} />}
      {status.files.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-fg-subtle">
          The working tree is clean. Changed files show up here as they are edited.
        </p>
      ) : null}
    </div>
  );
}
