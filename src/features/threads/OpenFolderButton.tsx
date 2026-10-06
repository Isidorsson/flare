import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useState } from "react";

import { useAgent } from "@/features/agent/use-agent";
import { useWorkspace } from "@/features/workspace/use-workspace";
import { describeError } from "@/shared/lib/describe-error";
import { baseName } from "@/shared/lib/path-name";
import { Tooltip } from "@/shared/ui/Tooltip";

export function OpenFolderButton() {
  const root = useWorkspace((state) => state.root);
  const setRoot = useWorkspace((state) => state.setRoot);
  const newThread = useAgent((state) => state.newThread);
  const [error, setError] = useState<string | null>(null);

  function pickFolder() {
    setError(null);
    open({
      directory: true,
      multiple: false,
      title: "Open project folder",
      ...(root === null ? {} : { defaultPath: root }),
    })
      .then((picked) => {
        if (picked === null) return;
        setRoot(picked);
        newThread();
      })
      .catch((failure: unknown) => {
        setError(describeError(failure));
      });
  }

  return (
    <div className="border-b border-border p-2">
      <Tooltip
        content={root === null ? "Open a project folder for Claude to work in" : "Change the project folder"}
        detail={root ?? undefined}
        side="right"
      >
        <button
          type="button"
          onClick={pickFolder}
          className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg"
        >
          <FolderOpen aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{root === null ? "Open folder" : baseName(root)}</span>
          {root !== null && <span className="shrink-0 text-xs text-fg-subtle">Change</span>}
        </button>
      </Tooltip>
      {error !== null && (
        <p role="alert" className="px-2 pt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
