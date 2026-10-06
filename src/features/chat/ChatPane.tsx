import { LoaderCircle } from "lucide-react";

import { selectActiveThread } from "@/features/agent/agent-selectors";
import { threadTitle } from "@/features/agent/thread-types";
import { useAgent } from "@/features/agent/use-agent";
import { baseName } from "@/shared/lib/path-name";
import { Tooltip } from "@/shared/ui/Tooltip";

import { Composer } from "./Composer";
import { formatCost } from "./format-cost";
import { Transcript } from "./Transcript";

function ChatHeader() {
  const thread = useAgent(selectActiveThread);
  const running = thread?.status === "running";

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
      <h1 className="min-w-0 truncate text-sm font-medium">{threadTitle(thread)}</h1>
      {thread && (
        <Tooltip content="Project folder" detail={thread.cwd}>
          <span tabIndex={0} className="shrink-0 text-xs text-fg-subtle">
            {baseName(thread.cwd)}
          </span>
        </Tooltip>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-fg-muted">
        {running && (
          <span className="flex items-center gap-1.5 text-accent">
            <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
            Working
          </span>
        )}
        {thread !== null && thread.costUsd > 0 && (
          <Tooltip content="Cost of this session so far">
            <span tabIndex={0}>{formatCost(thread.costUsd)}</span>
          </Tooltip>
        )}
      </div>
    </header>
  );
}

export function ChatPane() {
  const thread = useAgent(selectActiveThread);

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-bg">
      <ChatHeader />
      <Transcript thread={thread} />
      <Composer />
    </main>
  );
}
