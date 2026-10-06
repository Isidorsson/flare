import { TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";

import { Tooltip } from "@/shared/ui/Tooltip";

import type { DiskConflict } from "./files-types";
import { useFiles } from "./use-files";

function BannerButton({ className = "", ...rest }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={`h-6 rounded-md border border-border-strong px-2 text-xs text-fg transition-colors hover:bg-surface-3 ${className}`}
      {...rest}
    />
  );
}

export function ConflictBanner({ path, conflict }: { path: string; conflict: DiskConflict }) {
  const reloadFile = useFiles((state) => state.reloadFile);
  const saveFile = useFiles((state) => state.saveFile);
  const closeFile = useFiles((state) => state.closeFile);
  const modified = conflict.kind === "modified";

  return (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-border bg-accent-soft px-3 py-1.5 text-xs">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 text-fg-muted">
        {modified ? "This file changed on disk while you were editing it." : "This file was deleted on disk."}
      </p>
      {modified ? (
        <Tooltip content="Discard your edits and load the version on disk">
          <BannerButton
            onClick={() => {
              void reloadFile(path);
            }}
          >
            Reload from disk
          </BannerButton>
        </Tooltip>
      ) : (
        <Tooltip content="Close this tab; the file no longer exists">
          <BannerButton
            onClick={() => {
              closeFile(path);
            }}
          >
            Close
          </BannerButton>
        </Tooltip>
      )}
      <Tooltip content={modified ? "Save your version over the one on disk" : "Write your version back to disk"}>
        <BannerButton
          onClick={() => {
            void saveFile(path);
          }}
        >
          {modified ? "Overwrite" : "Recreate"}
        </BannerButton>
      </Tooltip>
    </div>
  );
}
