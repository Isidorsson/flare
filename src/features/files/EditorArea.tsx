import { Save } from "lucide-react";
import { Suspense, lazy, useMemo, type ReactNode } from "react";

import { IconButton } from "@/shared/ui/IconButton";

import { ConflictBanner } from "./ConflictBanner";
import { EditorTabs } from "./EditorTabs";
import { isDirty, type OpenFile, type TimelineEntry } from "./files-types";
import { relativeTo } from "./paths";
import { groupByTurn } from "./timeline";
import { useFiles } from "./use-files";

const MonacoFileEditor = lazy(() => import("./MonacoFileEditor").then((m) => ({ default: m.MonacoFileEditor })));
const MonacoDiffView = lazy(() => import("./MonacoDiffView").then((m) => ({ default: m.MonacoDiffView })));

const FILE_MESSAGES: Record<Exclude<OpenFile["status"], "ready" | "error">, string> = {
  loading: "Loading...",
  binary: "This is a binary or non-UTF-8 file, so it can't be shown here.",
  tooLarge: "This file is too large to open here.",
};

function PaneMessage({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return <p className={`p-4 text-xs ${tone === "error" ? "text-danger" : "text-fg-subtle"}`}>{children}</p>;
}

function EditorFallback() {
  return <PaneMessage>Loading editor...</PaneMessage>;
}

function FileHeader({ file, root }: { file: OpenFile; root: string | null }) {
  const saveFile = useFiles((state) => state.saveFile);
  const dirty = isDirty(file);
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
      <span className="min-w-0 flex-1 truncate text-fg-muted" title={file.path}>
        {root === null ? file.path : relativeTo(root, file.path)}
      </span>
      {file.error === null ? null : <span className="shrink-0 text-danger">{file.error}</span>}
      <IconButton
        icon={Save}
        label={file.saving ? "Saving..." : "Save (Ctrl+S)"}
        disabled={file.saving || (!dirty && file.conflict === null)}
        onClick={() => {
          void saveFile(file.path);
        }}
        className={dirty ? "text-accent" : ""}
      />
    </div>
  );
}

function FilePane({ path }: { path: string }) {
  const file = useFiles((state) => state.files[path]);
  const root = useFiles((state) => state.root);
  const setDraft = useFiles((state) => state.setDraft);
  const saveFile = useFiles((state) => state.saveFile);
  if (file === undefined) return null;
  if (file.status === "error") return <PaneMessage tone="error">{file.error}</PaneMessage>;
  if (file.status !== "ready") return <PaneMessage>{FILE_MESSAGES[file.status]}</PaneMessage>;

  return (
    <>
      <FileHeader file={file} root={root} />
      {file.conflict === null ? null : <ConflictBanner path={path} conflict={file.conflict} />}
      <div className="min-h-0 flex-1">
        <Suspense fallback={<EditorFallback />}>
          <MonacoFileEditor
            key={path}
            path={path}
            value={file.draft}
            onChange={(content) => {
              setDraft(path, content);
            }}
            onSave={() => {
              void saveFile(path);
            }}
          />
        </Suspense>
      </div>
    </>
  );
}

function DiffHeader({ entry, label }: { entry: TimelineEntry; label: string }) {
  const root = useFiles((state) => state.root);
  const openFile = useFiles((state) => state.openFile);
  const canOpen = entry.kind !== "delete";
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
      <span className="shrink-0 rounded bg-accent-soft px-1.5 text-[10px] leading-4 text-accent">{label}</span>
      <span className="min-w-0 flex-1 truncate text-fg-muted" title={entry.path}>
        {root === null ? entry.path : relativeTo(root, entry.path)}
      </span>
      {canOpen ? (
        <button
          type="button"
          onClick={() => {
            void openFile(entry.path);
          }}
          className="shrink-0 text-fg-muted underline-offset-2 hover:text-fg hover:underline"
        >
          Open file
        </button>
      ) : null}
    </div>
  );
}

function DiffPane({ changeId }: { changeId: string }) {
  const changes = useFiles((state) => state.changes);
  const entry = changes.find((change) => change.id === changeId);
  const groups = useMemo(() => groupByTurn(changes), [changes]);
  if (entry === undefined) return null;
  const label = groups.find((group) => group.turnId === entry.turnId)?.label ?? "Edit";

  return (
    <>
      <DiffHeader entry={entry} label={label} />
      <div className="min-h-0 flex-1">
        <Suspense fallback={<EditorFallback />}>
          <MonacoDiffView key={entry.id} entry={entry} />
        </Suspense>
      </div>
    </>
  );
}

export function EditorArea() {
  const active = useFiles((state) => state.active);
  return (
    <section aria-label="Editor" className="flex min-h-0 flex-1 flex-col bg-surface-1">
      <EditorTabs />
      {active?.kind === "diff" ? <DiffPane changeId={active.changeId} /> : null}
      {active?.kind === "file" ? <FilePane path={active.path} /> : null}
    </section>
  );
}
