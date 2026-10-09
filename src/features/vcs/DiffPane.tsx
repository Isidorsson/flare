import { FileDiff as FileDiffIcon, X } from "lucide-react";
import { Suspense, lazy, type ReactNode } from "react";

import type { TimelineEntry } from "@/features/files/files-types";
import { EmptyState } from "@/shared/ui/EmptyState";
import { IconButton } from "@/shared/ui/IconButton";
import { Tooltip } from "@/shared/ui/Tooltip";

import { useVcs } from "./use-vcs";
import type { FileDiff } from "./vcs-schemas";
import type { FileSelection } from "./vcs-types";

const MonacoDiffView = lazy(() => import("@/features/files/MonacoDiffView").then((m) => ({ default: m.MonacoDiffView })));

/** The files feature's diff widget takes an agent edit; a git diff has the same two texts. */
function asDiffEntry(diff: FileDiff, revision: number): TimelineEntry {
  return {
    id: `vcs-${String(revision)}`,
    turnId: "vcs",
    toolUseId: "vcs",
    path: diff.path,
    kind: diff.original === null ? "create" : "update",
    before: diff.original,
    after: diff.modified ?? "",
  };
}

function Message({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <p role={tone === "error" ? "alert" : undefined} className={`p-4 text-xs select-text ${tone === "error" ? "text-danger" : "text-fg-subtle"}`}>
      {children}
    </p>
  );
}

function DiffBody({ selection }: { selection: FileSelection }) {
  const diff = useVcs((state) => state.diff);
  if (diff.kind === "error") return <Message tone="error">Could not load the diff: {diff.message}</Message>;
  if (diff.kind !== "ready") return <Message>Loading the diff</Message>;
  if (diff.diff.binary) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={FileDiffIcon}
          title="Binary or too large"
          description={`${selection.path} is a binary file or larger than 5 MB, so there is no text diff to show. You can still stage or discard it from the list.`}
        />
      </div>
    );
  }
  return (
    <Suspense fallback={<Message>Loading editor</Message>}>
      <MonacoDiffView key={diff.revision} entry={asDiffEntry(diff.diff, diff.revision)} />
    </Suspense>
  );
}

function DiffHeader({ selection }: { selection: FileSelection }) {
  const selectFile = useVcs((state) => state.selectFile);
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
      <span className="shrink-0 rounded bg-accent-soft px-1.5 text-[10px] leading-4 text-accent">
        {selection.staged ? "Staged" : "Not staged"}
      </span>
      <Tooltip content={selection.path}>
        <span className="min-w-0 flex-1 truncate text-fg-muted">{selection.path}</span>
      </Tooltip>
      <IconButton
        icon={X}
        label="Close the diff"
        className="size-6 @2xl:hidden"
        onClick={() => {
          void selectFile(null);
        }}
      />
    </div>
  );
}

/**
 * The diff of the selected file, read-only. Beside the lists when there is room; under them, only while a
 * file is selected, when there is not.
 */
export function DiffPane() {
  const selection = useVcs((state) => state.selection);
  const placement =
    selection === null
      ? "hidden @2xl:flex"
      : "flex h-2/5 shrink-0 border-t border-border";
  return (
    <section
      aria-label="File diff"
      className={`${placement} min-h-0 flex-col bg-surface-1 @2xl:h-auto @2xl:min-w-0 @2xl:flex-1 @2xl:border-t-0`}
    >
      {selection === null ? (
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={FileDiffIcon}
            title="Pick a file to see its changes"
            description="Staged files are compared with the last commit, the others with what is staged."
          />
        </div>
      ) : (
        <>
          <DiffHeader selection={selection} />
          <div className="min-h-0 flex-1">
            <DiffBody selection={selection} />
          </div>
        </>
      )}
    </section>
  );
}
