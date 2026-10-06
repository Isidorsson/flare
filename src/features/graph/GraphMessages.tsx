import { FileX, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/shared/ui/EmptyState";

import { graphStore, useGraph } from "./use-graph";

function Centered({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center px-6">{children}</div>;
}

function IndexingMessage() {
  return (
    <Centered>
      <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        Indexing project…
      </p>
    </Centered>
  );
}

function FailureMessage({ message }: { message: string }) {
  return (
    <Centered>
      <div role="alert" className="flex max-w-72 flex-col items-center gap-3 text-center">
        <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-danger">
          <TriangleAlert aria-hidden className="size-5" />
        </span>
        <p className="text-sm font-medium text-fg">Couldn't build the graph</p>
        <p className="text-xs break-words text-fg-muted">{message}</p>
        <button
          type="button"
          onClick={() => {
            void graphStore.getState().reindex();
          }}
          className="rounded-md border border-border-strong bg-surface-2 px-3 py-1 text-xs text-fg transition-colors hover:bg-surface-3"
        >
          Try again
        </button>
      </div>
    </Centered>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="pointer-events-none absolute inset-x-2 top-2 rounded-md border border-danger/40 bg-surface-1/90 px-2.5 py-1.5 text-xs text-danger backdrop-blur"
    >
      {message}
    </p>
  );
}

export function GraphMessages() {
  const status = useGraph((state) => state.status);
  const error = useGraph((state) => state.error);
  const loaded = useGraph((state) => state.snapshot !== null);
  const empty = useGraph((state) => state.snapshot !== null && state.snapshot.nodes.length === 0);

  if (!loaded) {
    if (status === "error") return <FailureMessage message={error ?? "Unknown error"} />;
    return status === "loading" ? <IndexingMessage /> : null;
  }
  return (
    <>
      {empty ? (
        <Centered>
          <EmptyState
            icon={FileX}
            title="No source files found"
            description="Flare maps TypeScript, JavaScript, Rust and Python files that are not git-ignored."
          />
        </Centered>
      ) : null}
      {error === null ? null : <InlineError message={error} />}
    </>
  );
}
