import { X } from "lucide-react";
import { useState } from "react";

import { isDirty, type OpenFile } from "./files-types";
import { baseName } from "./paths";
import { useFiles } from "./use-files";

interface TabProps {
  file: OpenFile;
  selected: boolean;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

function Tab({ file, selected, onActivate, onClose }: TabProps) {
  const [confirming, setConfirming] = useState(false);
  const dirty = isDirty(file);
  const tone = selected ? "border-accent bg-surface-1 text-fg" : "border-transparent text-fg-muted hover:text-fg";

  function handleClose() {
    if (dirty && !confirming) {
      setConfirming(true);
      return;
    }
    onClose(file.path);
  }

  return (
    <div role="presentation" className={`group flex h-8 shrink-0 items-center border-b-2 ${tone}`}>
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        title={file.path}
        onClick={() => {
          onActivate(file.path);
        }}
        className={`flex h-full max-w-44 items-center gap-1.5 pr-1 pl-3 text-xs ${file.preview ? "italic" : ""}`}
      >
        <span className="truncate">{baseName(file.path)}</span>
        {dirty ? <span role="img" aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
      </button>
      <button
        type="button"
        aria-label={confirming ? `Discard changes to ${baseName(file.path)}` : `Close ${baseName(file.path)}`}
        onClick={handleClose}
        onBlur={() => {
          setConfirming(false);
        }}
        className={`mr-1 flex h-5 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg ${
          confirming ? "px-1.5 text-[10px] text-danger" : "w-5"
        }`}
      >
        {confirming ? "Discard?" : <X aria-hidden className="size-3" />}
      </button>
    </div>
  );
}

export function EditorTabs() {
  const tabs = useFiles((state) => state.tabs);
  const files = useFiles((state) => state.files);
  const active = useFiles((state) => state.active);
  const activateFile = useFiles((state) => state.activateFile);
  const closeFile = useFiles((state) => state.closeFile);

  if (tabs.length === 0) return null;
  const activePath = active?.kind === "file" ? active.path : null;

  return (
    <div role="tablist" aria-label="Open files" className="flex shrink-0 overflow-x-auto border-b border-border bg-surface-2">
      {tabs.map((path) => {
        const file = files[path];
        return file === undefined ? null : (
          <Tab key={path} file={file} selected={path === activePath} onActivate={activateFile} onClose={closeFile} />
        );
      })}
    </div>
  );
}
