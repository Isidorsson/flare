import { FileCode2, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { IconButton } from "@/shared/ui/IconButton";

import { graphIndexFor } from "./graph-index";
import { inspectFile, type FileRef, type InspectorModel } from "./inspector-model";
import { clock } from "./motion";
import { readCssVariable, readPalette } from "./palette";
import { ROLE_LABELS } from "./roles";
import { graphStore, useGraph } from "./use-graph";

const KIND_VERBS = { read: "Read", search: "Searched", edit: "Edited", create: "Created", run: "Ran" } as const;

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="space-y-1.5 border-t border-border px-3 py-2.5">
      <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.1em] text-fg-subtle uppercase">
        {title}
        {count === undefined ? null : (
          <span className="rounded-sm bg-surface-2 px-1 py-px font-mono tracking-normal text-fg-muted tabular-nums">{count}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Chip({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  const tone = accent ? "border-activity-edit/50 text-activity-edit" : "border-border text-fg-muted";
  return <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${tone}`}>{children}</span>;
}

function ActivityBlock({ model }: { model: InspectorModel }) {
  const { activity } = model;
  if (activity === null) return <p className="text-xs text-fg-subtle">The agent has not touched this file yet.</p>;
  const parts = [
    activity.edits > 0 ? `${KIND_VERBS.edit} ${activity.edits}×` : null,
    activity.reads > 0 ? `${activity.reads === 1 ? "read" : "read"} ${activity.reads}×` : null,
    activity.ago,
  ].filter((part) => part !== null);
  return (
    <div className="space-y-0.5 font-mono text-xs">
      <p className="text-fg">{parts.join(" · ")}</p>
      <p className="text-fg-subtle">
        By Claude{activity.linesChanged > 0 ? ` · ${activity.linesChanged} lines changed` : ""}
      </p>
    </div>
  );
}

function FileList({ files, total }: { files: readonly FileRef[]; total: number }) {
  if (files.length === 0) return <p className="text-xs text-fg-subtle">None.</p>;
  return (
    <ul className="space-y-px">
      {files.map((file) => (
        <li key={file.id}>
          <button
            type="button"
            onClick={() => {
              graphStore.getState().select(file.id);
            }}
            className="flex w-full items-baseline gap-2 rounded-sm px-1 py-0.5 text-left font-mono text-xs transition-colors hover:bg-surface-2"
          >
            <span className="shrink-0 text-fg">{file.name}</span>
            <span className="min-w-0 truncate text-fg-subtle">{file.folder}</span>
          </button>
        </li>
      ))}
      {total > files.length ? <li className="px-1 pt-0.5 font-mono text-[11px] text-fg-subtle">+{total - files.length} more</li> : null}
    </ul>
  );
}

function ImpactNote({ model }: { model: InspectorModel }) {
  const text =
    model.affected === 0
      ? "Nothing else depends on this file."
      : `This change can affect ${model.affected} ${model.affected === 1 ? "file" : "files"}; ${model.tests} ${model.tests === 1 ? "test covers" : "tests cover"} it.`;
  return <p className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-fg-muted">{text}</p>;
}

function Header({ model }: { model: InspectorModel }) {
  return (
    <header className="space-y-2 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <FileCode2 aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-[13px] font-semibold text-fg">{model.name}</h2>
          <p className="truncate font-mono text-[11px] text-fg-subtle">{model.folder === "" ? "project root" : model.folder}</p>
        </div>
        <IconButton
          icon={X}
          label="Close details"
          onClick={() => {
            graphStore.getState().select(null);
          }}
          className="-mt-1 -mr-1.5"
        />
      </div>
    </header>
  );
}

function Inspector({ model, onOpen }: { model: InspectorModel; onOpen: (id: string) => void }) {
  const [palette] = useState(() => readPalette(readCssVariable));
  return (
    <aside
      aria-label={`Details for ${model.name}`}
      className="absolute inset-y-0 right-0 z-10 flex w-72 max-w-[88%] flex-col overflow-y-auto border-l border-border bg-bg/95 backdrop-blur-sm"
    >
      <Header model={model} />
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
        <Chip>
          <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: palette.roles[model.role] }} />
          {ROLE_LABELS[model.role]}
        </Chip>
        {model.changedThisTurn ? <Chip accent>Changed this turn</Chip> : null}
        <button
          type="button"
          onClick={() => {
            onOpen(model.id);
          }}
          className="ml-auto rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
        >
          Open
        </button>
      </div>
      <Section title="Agent activity">
        <ActivityBlock model={model} />
      </Section>
      <Section title="Imported by" count={model.importerCount}>
        <ImpactNote model={model} />
        <FileList files={model.importers} total={model.importerCount} />
      </Section>
      <Section title="Imports" count={model.importCount}>
        <FileList files={model.imports} total={model.importCount} />
      </Section>
    </aside>
  );
}

export function GraphInspector({ onOpenFile }: { onOpenFile: (id: string) => void }) {
  const selected = useGraph((state) => state.selected);
  const snapshot = useGraph((state) => state.snapshot);
  const activity = useGraph((state) => (state.selected === null ? undefined : state.activity.nodes.get(state.selected)));
  const turn = useGraph((state) => state.activity.turn);
  if (selected === null || snapshot === null) return null;
  const model = inspectFile(graphIndexFor(snapshot), selected, { activity, turn, now: clock() });
  return model === null ? null : <Inspector key={selected} model={model} onOpen={onOpenFile} />;
}
