import { Radar, RefreshCw, TriangleAlert } from "lucide-react";

import { IconButton } from "@/shared/ui/IconButton";

import type { ColorBy } from "./graph-store";
import { graphStore, useGraph } from "./use-graph";

const COLOR_MODES: readonly { value: ColorBy; label: string }[] = [
  { value: "language", label: "Language" },
  { value: "directory", label: "Folder" },
];

const NO_WARNINGS: readonly string[] = [];

function ColorModeSwitch() {
  const colorBy = useGraph((state) => state.colorBy);
  return (
    <div role="group" aria-label="Colour nodes by" className="flex rounded-md border border-border bg-surface-1 p-0.5">
      {COLOR_MODES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={colorBy === value}
          onClick={() => {
            graphStore.getState().setColorBy(value);
          }}
          className={`rounded-sm px-2 py-0.5 text-xs transition-colors ${
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

function Counts() {
  const files = useGraph((state) => state.snapshot?.nodes.length ?? 0);
  const imports = useGraph((state) => state.snapshot?.edges.length ?? 0);
  return (
    <span className="px-1 text-xs text-fg-subtle tabular-nums">
      {files} files · {imports} imports
    </span>
  );
}

export function GraphToolbar() {
  const blastMode = useGraph((state) => state.mode === "blast");
  const loading = useGraph((state) => state.status === "loading");
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2">
      <div className="pointer-events-auto rounded-md border border-border bg-surface-1/90 py-1 backdrop-blur">
        <Counts />
      </div>
      <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-border bg-surface-1/90 p-0.5 backdrop-blur">
        <WarningBadge />
        <ColorModeSwitch />
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
