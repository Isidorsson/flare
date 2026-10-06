import { Radar, RefreshCw, TriangleAlert } from "lucide-react";

import { IconButton } from "@/shared/ui/IconButton";
import { Tooltip } from "@/shared/ui/Tooltip";

import { GraphCameraControls } from "./GraphCameraControls";
import { HudChips } from "./HudChips";
import { BLAST_LABEL, blastToggleDetail } from "./blast-copy";
import type { ColorBy } from "./graph-store";
import { PRESSED_CLASS } from "./toolbar-style";
import { graphStore, useGraph } from "./use-graph";

const COLOR_MODES: readonly { value: ColorBy; label: string; hint: string }[] = [
  { value: "role", label: "Role", hint: "Colour nodes by what the code is for: frontend, API, tests, config" },
  { value: "language", label: "Language", hint: "Colour nodes by programming language" },
  { value: "directory", label: "Folder", hint: "Colour nodes by the folder they are in" },
];

const NO_WARNINGS: readonly string[] = [];

function ColorModeSwitch() {
  const colorBy = useGraph((state) => state.colorBy);
  return (
    <div role="group" aria-label="Colour nodes by" className="flex rounded-md border border-border bg-surface-2 p-0.5">
      {COLOR_MODES.map(({ value, label, hint }) => (
        <Tooltip key={value} content={hint}>
          <button
            type="button"
            aria-pressed={colorBy === value}
            onClick={() => {
              graphStore.getState().setColorBy(value);
            }}
            className={`rounded-sm px-2 py-0.5 font-mono text-[11px] transition-colors ${
              colorBy === value ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            {label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function WarningBadge() {
  const warnings = useGraph((state) => state.snapshot?.warnings ?? NO_WARNINGS);
  if (warnings.length === 0) return null;
  return (
    <Tooltip content="Some files could not be indexed" detail={warnings.join("\n")}>
      <span
        role="img"
        tabIndex={0}
        aria-label={`${warnings.length} indexing warnings`}
        className="inline-flex size-7 items-center justify-center text-warning"
      >
        <TriangleAlert aria-hidden className="size-4" />
      </span>
    </Tooltip>
  );
}

function BlastToggle() {
  const on = useGraph((state) => state.reach === "blast");
  const hasSelection = useGraph((state) => state.selected !== null);
  return (
    <IconButton
      icon={Radar}
      label={BLAST_LABEL}
      detail={blastToggleDetail(on, hasSelection)}
      aria-pressed={on}
      onClick={() => {
        graphStore.getState().setReach(on ? "direct" : "blast");
      }}
      className={on ? PRESSED_CLASS : ""}
    />
  );
}

export function GraphToolbar() {
  const loading = useGraph((state) => state.status === "loading");
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border bg-bg px-2 py-1.5">
      <HudChips />
      <div className="ml-auto flex items-center gap-1">
        <WarningBadge />
        <ColorModeSwitch />
        <GraphCameraControls />
        <BlastToggle />
        <IconButton
          icon={RefreshCw}
          label="Reindex the project"
          disabledReason={loading ? "Indexing is already running" : undefined}
          onClick={() => {
            void graphStore.getState().reindex();
          }}
          className={loading ? "[&>svg]:animate-spin" : ""}
        />
      </div>
    </div>
  );
}
