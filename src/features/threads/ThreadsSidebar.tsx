import { Flame, SquarePen } from "lucide-react";

import { useAgent } from "@/features/agent/use-agent";
import { IconButton } from "@/shared/ui/IconButton";

import { OpenFolderButton } from "./OpenFolderButton";
import { ThreadList } from "./ThreadList";

export function ThreadsSidebar() {
  const newThread = useAgent((state) => state.newThread);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border pr-2 pl-4">
        <div className="flex items-center gap-2">
          <Flame aria-hidden className="size-4 text-accent" />
          <span className="text-sm font-semibold tracking-tight">Flare</span>
        </div>
        <IconButton icon={SquarePen} label="New thread" onClick={newThread} />
      </header>
      <OpenFolderButton />
      <nav aria-label="Threads" className="flex min-h-0 flex-1 flex-col">
        <ThreadList />
      </nav>
    </div>
  );
}
