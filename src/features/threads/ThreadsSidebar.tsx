import { Flame, MessagesSquare, SquarePen } from "lucide-react";

import { EmptyState } from "@/shared/ui/EmptyState";
import { IconButton } from "@/shared/ui/IconButton";

export function ThreadsSidebar() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border pr-2 pl-4">
        <div className="flex items-center gap-2">
          <Flame aria-hidden className="size-4 text-accent" />
          <span className="text-sm font-semibold tracking-tight">Flare</span>
        </div>
        <IconButton icon={SquarePen} label="New thread" disabled />
      </header>
      <nav aria-label="Threads" className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
        <EmptyState
          icon={MessagesSquare}
          title="No threads yet"
          description="Conversations with Claude in this project will be listed here."
        />
      </nav>
    </div>
  );
}
