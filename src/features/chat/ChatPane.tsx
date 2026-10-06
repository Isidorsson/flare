import { MessageSquare, SendHorizontal } from "lucide-react";

import { EmptyState } from "@/shared/ui/EmptyState";
import { IconButton } from "@/shared/ui/IconButton";

function Composer() {
  return (
    <form className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-surface-1 p-2 focus-within:border-border-strong">
        <textarea
          disabled
          rows={2}
          aria-label="Message Claude"
          placeholder="Message Claude"
          className="min-h-10 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed"
        />
        <IconButton icon={SendHorizontal} label="Send message" disabled />
      </div>
      <p className="mt-2 text-center text-xs text-fg-subtle">The agent is not connected yet.</p>
    </form>
  );
}

export function ChatPane() {
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex h-11 shrink-0 items-center border-b border-border px-4">
        <h1 className="text-sm font-medium">New thread</h1>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
        <EmptyState
          icon={MessageSquare}
          title="Start a conversation"
          description="Ask Claude to read, explain or change your project. Replies, tool calls and approvals stream in here."
        />
      </div>
      <Composer />
    </main>
  );
}
