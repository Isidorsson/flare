import { X } from "lucide-react";
import { useState } from "react";

import { isDirty, type OpenFile } from "./files-types";
import { isPulsing, type HeatEntry } from "./live/heat";
import type { TouchKind } from "./live/live-types";
import { useHeatView } from "./live/use-heat";
import { baseName } from "./paths";
import { useFiles } from "./use-files";

const ACTIVITY_UNDERLINE: Record<TouchKind, string> = {
  read: "border-read",
  edit: "border-claude",
};

const ACTIVITY_DOT: Record<TouchKind, { tone: string; label: string }> = {
  read: { tone: "bg-read", label: "The agent just read this file" },
  edit: { tone: "bg-claude", label: "The agent just edited this file" },
};

interface Activity {
  entry: HeatEntry;
  pulsing: boolean;
}

function underline(selected: boolean, activity: Activity | undefined): string {
  if (activity !== undefined) return ACTIVITY_UNDERLINE[activity.entry.lastKind];
  return selected ? "border-accent" : "border-transparent";
}

function ActivityDot({ entry }: { entry: HeatEntry }) {
  const { tone, label } = ACTIVITY_DOT[entry.lastKind];
  return <span role="img" aria-label={label} className={`flare-tab-dot size-1.5 shrink-0 rounded-full ${tone}`} />;
}

function CloseButton({ file, dirty, onClose }: { file: OpenFile; dirty: boolean; onClose: (path: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const name = baseName(file.path);

  function handleClose() {
    if (dirty && !confirming) {
      setConfirming(true);
      return;
    }
    onClose(file.path);
  }

  return (
    <button
      type="button"
      aria-label={confirming ? `Discard changes to ${name}` : `Close ${name}`}
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
  );
}

interface TabProps {
  file: OpenFile;
  selected: boolean;
  activity: Activity | undefined;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

function Tab({ file, selected, activity, onActivate, onClose }: TabProps) {
  const dirty = isDirty(file);
  const tone = selected ? "bg-surface-1 text-fg" : "text-fg-muted hover:text-fg";
  return (
    <div role="presentation" className={`group flex h-8 shrink-0 items-center border-b-2 ${underline(selected, activity)} ${tone}`}>
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
        {activity?.pulsing === true ? <ActivityDot key={activity.entry.touchedAt} entry={activity.entry} /> : null}
      </button>
      <CloseButton file={file} dirty={dirty} onClose={onClose} />
    </div>
  );
}

export function EditorTabs() {
  const tabs = useFiles((state) => state.tabs);
  const files = useFiles((state) => state.files);
  const active = useFiles((state) => state.active);
  const activateFile = useFiles((state) => state.activateFile);
  const closeFile = useFiles((state) => state.closeFile);
  const heat = useHeatView();

  if (tabs.length === 0) return null;
  const activePath = active?.kind === "file" ? active.path : null;

  return (
    <div role="tablist" aria-label="Open files" className="flex shrink-0 overflow-x-auto border-b border-border bg-surface-2">
      {tabs.map((path) => {
        const file = files[path];
        const entry = heat.files.get(path);
        const activity = entry === undefined ? undefined : { entry, pulsing: isPulsing(entry, heat.now) };
        return file === undefined ? null : (
          <Tab
            key={path}
            file={file}
            selected={path === activePath}
            activity={activity}
            onActivate={activateFile}
            onClose={closeFile}
          />
        );
      })}
    </div>
  );
}
