import {
  Check,
  ChevronRight,
  FilePlus,
  FileText,
  Globe,
  LoaderCircle,
  Pencil,
  Search,
  Terminal,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { ToolItem, ToolStatus, TouchedAction, TouchedFile } from "@/features/agent/thread-types";
import { baseName } from "@/shared/lib/path-name";
import { Tooltip } from "@/shared/ui/Tooltip";

import { formatToolInput, previewToolInput } from "./tool-preview";

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: Terminal,
  PowerShell: Terminal,
  Read: FileText,
  Edit: Pencil,
  MultiEdit: Pencil,
  NotebookEdit: Pencil,
  Write: FilePlus,
  Grep: Search,
  Glob: Search,
  WebFetch: Globe,
  WebSearch: Globe,
};

const TOUCH_DESCRIPTIONS: Record<TouchedAction, string> = {
  read: "Read by this tool call",
  create: "Created by this tool call",
  update: "Edited by this tool call",
};

const STATUS_LABELS: Record<ToolStatus, string> = {
  running: "Running",
  done: "Finished",
  error: "Failed",
};

function StatusIcon({ status }: { status: ToolStatus }) {
  const label = STATUS_LABELS[status];
  if (status === "running") {
    return <LoaderCircle role="img" aria-label={label} className="size-3.5 shrink-0 animate-spin text-accent" />;
  }
  if (status === "done") return <Check role="img" aria-label={label} className="size-3.5 shrink-0 text-success" />;
  return <X role="img" aria-label={label} className="size-3.5 shrink-0 text-danger" />;
}

function TouchedList({ files }: { files: TouchedFile[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.map((file) => (
        <li key={`${file.action}:${file.path}`}>
          <Tooltip content={TOUCH_DESCRIPTIONS[file.action]} detail={file.path}>
            <span className="block rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
              {file.action} {baseName(file.path)}
            </span>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium tracking-wide text-fg-subtle uppercase">{title}</p>
      {children}
    </div>
  );
}

export function ToolCard({ item }: { item: ToolItem }) {
  const Icon = TOOL_ICONS[item.name] ?? Wrench;
  const preview = previewToolInput(item.input);

  return (
    <details className="group rounded-lg border border-border bg-surface-1">
      <Tooltip content="Show or hide the input and result" side="top">
        <summary className="flex cursor-default list-none items-center gap-2 px-3 py-2 text-xs marker:hidden [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-subtle transition-transform group-open:rotate-90" />
          <Icon aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
          <span className="shrink-0 font-medium text-fg">{item.name}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-fg-muted">{preview}</span>
          <StatusIcon status={item.status} />
        </summary>
      </Tooltip>
      <div className="space-y-3 border-t border-border px-3 py-3 select-text">
        {item.touched.length > 0 && <TouchedList files={item.touched} />}
        <Section title="Input">
          <pre className="max-h-64 overflow-auto rounded-md bg-bg p-2 font-mono text-[11px] whitespace-pre-wrap text-fg-muted">
            {formatToolInput(item.input)}
          </pre>
        </Section>
        {item.summary !== "" && (
          <Section title="Result">
            <pre className="max-h-64 overflow-auto rounded-md bg-bg p-2 font-mono text-[11px] whitespace-pre-wrap text-fg-muted">
              {item.summary}
            </pre>
          </Section>
        )}
      </div>
    </details>
  );
}
