import { useMemo } from "react";

import { LatestTurnUndo } from "@/features/checkpoints/LatestTurnUndo";
import { Tooltip } from "@/shared/ui/Tooltip";

import { agentActivity } from "./live/use-live";
import { summarizeTurn, type TurnFile } from "./live/turn-summary";
import { baseName, relativeTo } from "./paths";
import { useFiles } from "./use-files";

function Chip({ file, root }: { file: TurnFile; root: string | null }) {
  const created = file.kind === "create";
  const shown = root === null ? file.path : relativeTo(root, file.path);
  return (
    <Tooltip content="Replay this change in the editor" detail={`${shown}\n${created ? "Created" : "Edited"} this turn`}>
      <button
        type="button"
        onClick={() => {
          agentActivity.replay(file.path);
        }}
        className="flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2 text-[11px] text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
      >
        <span aria-hidden className={`size-1.5 rounded-full ${created ? "bg-success" : "bg-agent"}`} />
        {baseName(file.path)}
      </button>
    </Tooltip>
  );
}

function pluralFiles(count: number): string {
  return `${String(count)} ${count === 1 ? "file" : "files"}`;
}

/** What the agent changed in the turn that is running or just ended, with a chip per file that replays its change. */
export function TurnStrip() {
  const changes = useFiles((state) => state.changes);
  const turnId = useFiles((state) => state.turnId);
  const root = useFiles((state) => state.root);
  const summary = useMemo(() => summarizeTurn(changes, turnId), [changes, turnId]);
  if (summary.files.length === 0) return null;

  return (
    <div aria-label="Changed this turn" className="flex h-8 shrink-0 items-center gap-3 border-b border-border px-3 text-xs">
      <span className="shrink-0 text-fg-muted">
        {pluralFiles(summary.files.length)} changed this turn <span className="text-success">+{summary.added}</span>{" "}
        <span className="text-danger">−{summary.removed}</span>
      </span>
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {summary.files.map((file) => (
          <Chip key={file.path} file={file} root={root} />
        ))}
      </div>
      <span className="ml-auto shrink-0">
        <LatestTurnUndo />
      </span>
    </div>
  );
}
