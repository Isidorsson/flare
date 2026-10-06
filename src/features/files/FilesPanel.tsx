import { FolderOpen } from "lucide-react";
import type { KeyboardEvent } from "react";

import { useWorkspace } from "@/features/workspace/use-workspace";
import { EmptyState } from "@/shared/ui/EmptyState";

import "./live/live-theme";

import { EditTimeline } from "./EditTimeline";
import { EditorArea } from "./EditorArea";
import { FileTree } from "./FileTree";
import { FilesToolbar } from "./FilesToolbar";
import { TurnStrip } from "./TurnStrip";
import { useFiles } from "./use-files";

function isSaveShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s";
}

function FilesWorkspace() {
  const pane = useFiles((state) => state.pane);
  const hasEditor = useFiles((state) => state.active !== null);
  const saveActive = useFiles((state) => state.saveActive);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isSaveShortcut(event)) return;
    event.preventDefault();
    void saveActive();
  }

  const sourceSize = hasEditor ? "h-2/5 shrink-0 border-b border-border" : "flex-1";
  return (
    <div onKeyDown={handleKeyDown} className="flex h-full min-h-0 w-full flex-col">
      <FilesToolbar />
      <TurnStrip />
      <div className={`min-h-0 overflow-y-auto ${sourceSize}`}>{pane === "explorer" ? <FileTree /> : <EditTimeline />}</div>
      {hasEditor ? <EditorArea /> : null}
    </div>
  );
}

export function FilesPanel() {
  const root = useWorkspace((state) => state.root);
  if (root === null) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <EmptyState
          icon={FolderOpen}
          title="No folder open"
          description="Open a project folder to browse its files and follow the agent's edits."
        />
      </div>
    );
  }
  return <FilesWorkspace />;
}
