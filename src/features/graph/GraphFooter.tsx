import { useState, type ReactNode } from "react";

import { ACTIVITY_TOKENS } from "./activity-palette";
import { folderColor } from "./appearance";
import { graphIndexFor, type GraphIndex } from "./graph-index";
import { baseName } from "./graph-paths";
import { LANGUAGES, type Language } from "./graph-types";
import type { GraphLevel } from "./graph-store";
import { readCssVariable, readPalette, type Palette } from "./palette";
import { ROLE_LABELS, ROLES } from "./roles";
import { graphStore, useGraph } from "./use-graph";

const LANGUAGE_LABELS: Record<Language, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  rust: "Rust",
  python: "Python",
  lua: "Lua",
  luau: "Luau",
  go: "Go",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  java: "Java",
  kotlin: "Kotlin",
  ruby: "Ruby",
  php: "PHP",
  swift: "Swift",
  dart: "Dart",
  zig: "Zig",
  shell: "Shell",
  css: "CSS",
  vue: "Vue",
  svelte: "Svelte",
};

const LEVELS: readonly { value: GraphLevel; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "files", label: "Files" },
];

const ACTIVITY_LEGEND = [
  { token: ACTIVITY_TOKENS.edit, label: "edited" },
  { token: ACTIVITY_TOKENS.create, label: "new" },
  { token: ACTIVITY_TOKENS.read, label: "read" },
] as const;

const FOLDER_LEGEND_LIMIT = 6;

interface LegendItem {
  color: string;
  label: string;
  count?: number | undefined;
}

function Swatch({ color, label, count }: LegendItem) {
  return (
    <li className="flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
      {count === undefined ? null : <span className="text-fg-subtle/80 tabular-nums">{count}</span>}
    </li>
  );
}

function Legend({ items, label }: { items: readonly LegendItem[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {items.map((item) => (
        <Swatch key={item.label} {...item} />
      ))}
    </ul>
  );
}

function roleItems(index: GraphIndex, palette: Palette): LegendItem[] {
  return ROLES.filter((role) => index.roleCounts[role] > 0).map((role) => ({
    color: palette.roles[role],
    label: ROLE_LABELS[role],
    count: index.roleCounts[role],
  }));
}

function languageItems(palette: Palette, languages: ReadonlyMap<Language, number>): LegendItem[] {
  return LANGUAGES.filter((language) => languages.has(language)).map((language) => ({
    color: palette.language[language],
    label: LANGUAGE_LABELS[language],
    count: languages.get(language),
  }));
}

function folderItems(index: GraphIndex, palette: Palette): LegendItem[] {
  return [...index.hubs]
    .filter((hub) => hub !== "")
    .sort((a, b) => (index.folders.get(b)?.size ?? 0) - (index.folders.get(a)?.size ?? 0))
    .slice(0, FOLDER_LEGEND_LIMIT)
    .map((hub) => ({ color: folderColor(palette, hub), label: `${baseName(hub)}/`, count: index.folders.get(hub)?.size }));
}

function countLanguages(nodes: readonly { language: Language }[]): Map<Language, number> {
  const counts = new Map<Language, number>();
  for (const { language } of nodes) counts.set(language, (counts.get(language) ?? 0) + 1);
  return counts;
}

function ColorLegend({ palette }: { palette: Palette }) {
  const colorBy = useGraph((state) => state.colorBy);
  const snapshot = useGraph((state) => state.snapshot);
  if (snapshot === null) return null;
  const index = graphIndexFor(snapshot);
  if (colorBy === "language") {
    return <Legend label="Languages" items={languageItems(palette, countLanguages(snapshot.nodes))} />;
  }
  return <Legend label={colorBy === "role" ? "Roles" : "Folders"} items={colorBy === "role" ? roleItems(index, palette) : folderItems(index, palette)} />;
}

function ActivityLegend() {
  return (
    <ul aria-label="Agent activity" className="flex items-center gap-x-3">
      {ACTIVITY_LEGEND.map(({ token, label }) => (
        <Swatch key={label} color={`var(${token})`} label={label} />
      ))}
    </ul>
  );
}

function blastMessage(origin: string, dependents: number | null): string {
  if (dependents === null) return `Tracing dependents of ${baseName(origin)}…`;
  if (dependents === 0) return `Nothing imports ${baseName(origin)}`;
  const noun = dependents === 1 ? "file depends" : "files depend";
  return `${dependents} ${noun} on ${baseName(origin)}`;
}

function BlastFooter({ palette }: { palette: Palette }) {
  const blast = useGraph((state) => state.blast);
  if (blast === null) return <p>Click a file to see everything that depends on it.</p>;
  const items = [
    { color: palette.blastOrigin, label: "Selected" },
    { color: palette.blastDepths[0] ?? palette.dim, label: "Direct" },
    { color: palette.blastDepths[1] ?? palette.dim, label: "2 hops" },
    { color: palette.blastDepths[2] ?? palette.dim, label: "3+ hops" },
  ];
  return (
    <div className="space-y-1">
      <p role="status" className="text-fg">
        {blastMessage(blast.origin, blast.depths?.size ?? null)}
      </p>
      <Legend label="Blast radius" items={items} />
    </div>
  );
}

function LevelControl() {
  const level = useGraph((state) => state.level);
  return (
    <div role="group" aria-label="Zoom level" className="flex shrink-0 rounded-md border border-border bg-surface-2 p-0.5">
      {LEVELS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={level === value}
          onClick={() => {
            graphStore.getState().setLevel(value);
          }}
          className={`rounded-sm px-2 py-0.5 text-[11px] transition-colors ${level === value ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg"}`}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        disabled
        title="Symbols need a symbol index, which Flare does not build yet"
        className="rounded-sm px-2 py-0.5 text-[11px] text-fg-subtle opacity-50"
      >
        Symbols
      </button>
    </div>
  );
}

function Legends({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">{children}</div>;
}

export function GraphFooter() {
  const mode = useGraph((state) => state.mode);
  const [palette] = useState(() => readPalette(readCssVariable));
  return (
    <div className="flex shrink-0 items-end justify-between gap-3 border-t border-border bg-bg px-2.5 py-1.5 font-mono text-[11px] text-fg-muted">
      <Legends>
        {mode === "blast" ? <BlastFooter palette={palette} /> : <ColorLegend palette={palette} />}
        {mode === "blast" ? null : <ActivityLegend />}
      </Legends>
      <LevelControl />
    </div>
  );
}
