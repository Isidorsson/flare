import { Radar, RefreshCw, TriangleAlert } from "lucide-react";

import { IconButton } from "@/shared/ui/IconButton";

import { GraphCameraControls } from "./GraphCameraControls";
import { HudChips } from "./HudChips";
import type { ColorBy } from "./graph-store";
import { graphStore, useGraph } from "./use-graph";

const COLOR_MODES: readonly { value: ColorBy; label: string }[] = [
  { value: "role", label: "Role" },
  { value: "language", label: "Language" },
  { value: "directory", label: "Folder" },
];

const NO_WARNINGS: readonly string[] = [];

function ColorModeSwitch() {
  const colorBy = useGraph((state) => state.colorBy);
  return (
    <div role="group" aria-label="Colour nodes by" className="flex rounded-md border border-border bg-surface-2 p-0.5">
      {COLOR_MODES.map(({ value, label }) => (
        <button
          key={value}
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
      ))}
    </div>
  );
}

function WarningBadge() {
  const warnings = useGraph((state) => state.snapshot?.warnings ?? NO_WARNINGS);
  if (warnings.length === 0) return null;
  return (
    <span
      role="img"
      aria-label={`${warnings.length} indexing warnings`}
      title={warnings.join("\n")}
      className="inline-flex size-7 items-center justify-center text-warning"
    >
      <TriangleAlert aria-hidden className="size-4" />
    </span>
  );
}

export function GraphToolbar() {
  const blastMode = useGraph((state) => state.mode === "blast");
  const loading = useGraph((state) => state.status === "loading");
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border bg-bg px-2 py-1.5">
      <HudChips />
      <div className="ml-auto flex items-center gap-1">
        <WarningBadge />
        <ColorModeSwitch />
        <GraphCameraControls />
        <IconButton
          icon={Radar}
          label="Blast radius"
          aria-pressed={blastMode}
          onClick={() => {
            graphStore.getState().setMode(blastMode ? "explore" : "blast");
          }}
          className={blastMode ? "bg-accent-soft! text-accent! hover:bg-accent-soft! hover:text-accent!" : ""}
        />
        <IconButton
          icon={RefreshCw}
          label="Reindex"
          disabled={loading}
          onClick={() => {
            void graphStore.getState().reindex();
          }}
          className={loading ? "[&>svg]:animate-spin" : ""}
        />
      </div>
    </div>
  );
}
