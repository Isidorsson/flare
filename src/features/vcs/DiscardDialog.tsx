import { pluralFiles, splitPath } from "./change-labels";
import { ConfirmDialog } from "./ConfirmDialog";

const LISTED_PATHS = 6;

interface DiscardDialogProps {
  paths: readonly string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function DiscardDialog({ paths, onConfirm, onCancel }: DiscardDialogProps) {
  const [first] = paths;
  const title =
    paths.length === 1 && first !== undefined
      ? `Discard changes to ${splitPath(first).name}?`
      : `Discard changes to ${pluralFiles(paths.length)}?`;
  const hidden = paths.length - LISTED_PATHS;
  return (
    <ConfirmDialog title={title} confirmLabel="Discard changes" danger onConfirm={onConfirm} onCancel={onCancel}>
      <p className="text-xs text-fg-muted">
        {paths.length === 1 ? "The file goes" : "The files go"} back to the last staged or committed version. The edits
        are lost and cannot be brought back.
      </p>
      <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-surface-1 py-1 text-xs">
        {paths.slice(0, LISTED_PATHS).map((path) => (
          <li key={path} className="px-2 py-0.5 font-mono break-all text-fg">
            {path}
          </li>
        ))}
        {hidden > 0 ? <li className="px-2 py-0.5 text-fg-subtle">and {hidden} more</li> : null}
      </ul>
    </ConfirmDialog>
  );
}
