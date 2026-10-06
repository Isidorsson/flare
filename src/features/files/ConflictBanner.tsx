import { TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";

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
        <BannerButton
          onClick={() => {
            void reloadFile(path);
          }}
        >
          Reload from disk
        </BannerButton>
      ) : (
        <BannerButton
          onClick={() => {
            closeFile(path);
          }}
        >
          Close
        </BannerButton>
      )}
      <BannerButton
        onClick={() => {
          void saveFile(path);
        }}
      >
        {modified ? "Overwrite" : "Recreate"}
      </BannerButton>
    </div>
  );
}
