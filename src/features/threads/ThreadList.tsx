import { MessagesSquare } from "lucide-react";

import { threadTitle, type Thread } from "@/features/agent/thread-types";
import { useAgent } from "@/features/agent/use-agent";
import { baseName } from "@/shared/lib/path-name";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Tooltip } from "@/shared/ui/Tooltip";

interface ThreadRowProps {
  thread: Thread;
  active: boolean;
  onSelect: (id: string) => void;
}

function ThreadRow({ thread, active, onSelect }: ThreadRowProps) {
  const running = thread.status === "running";
  return (
    <li>
      <Tooltip content="Open this thread" detail={`${threadTitle(thread)}\n${thread.cwd}`} side="right">
        <button
          type="button"
          aria-current={active ? "true" : undefined}
          onClick={() => {
            onSelect(thread.id);
          }}
          className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${
            active ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
          }`}
        >
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">{threadTitle(thread)}</span>
            {running && (
              <span role="img" aria-label="Running" className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
            )}
          </span>
          <span className="truncate text-xs text-fg-subtle">{baseName(thread.cwd)}</span>
        </button>
      </Tooltip>
    </li>
  );
}

export function ThreadList() {
  const threads = useAgent((state) => state.threads);
  const activeThreadId = useAgent((state) => state.activeThreadId);
  const selectThread = useAgent((state) => state.selectThread);

  if (threads.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          icon={MessagesSquare}
          title="No threads yet"
          description="Conversations you start in this session are listed here. Pick one to resume it."
        />
      </div>
    );
  }

  return (
    <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
      {threads.map((thread) => (
        <ThreadRow key={thread.id} thread={thread} active={thread.id === activeThreadId} onSelect={selectThread} />
      ))}
    </ul>
  );
}
