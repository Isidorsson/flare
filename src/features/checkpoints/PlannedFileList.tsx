import type { FileAction, PlannedFile } from "./checkpoint-schemas";
import { Tooltip } from "@/shared/ui/Tooltip";

const ACTION_LABELS: Record<FileAction, string> = {
  revert: "Restore",
  delete: "Remove",
  recreate: "Bring back",
};

const ACTION_TONES: Record<FileAction, string> = {
  revert: "text-agent",
  delete: "text-danger",
  recreate: "text-success",
};

function FileRow({ file }: { file: PlannedFile }) {
  return (
    <li className="flex items-start gap-2 px-2 py-1">
      <span className={`w-[4.5rem] shrink-0 ${ACTION_TONES[file.action]}`}>{ACTION_LABELS[file.action]}</span>
      <span className="min-w-0 flex-1 font-mono break-all text-fg">{file.path}</span>
      {file.conflict && (
        <Tooltip
          content="Edited after this turn"
          detail="Continuing discards that edit. A safety copy is kept, so you can redo it."
          side="left"
        >
          <span tabIndex={0} className="shrink-0 text-warning">
            edited since
          </span>
        </Tooltip>
      )}
    </li>
  );
}

/** The files a restore will change, each with what happens to it and whether it was edited since. */
export function PlannedFileList({ files }: { files: readonly PlannedFile[] }) {
  return (
    <ul
      aria-label="Files that will change"
      className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface-1 text-xs select-text"
    >
      {files.map((file) => (
        <FileRow key={file.path} file={file} />
      ))}
    </ul>
  );
}
