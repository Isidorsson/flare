import { X } from "lucide-react";
import { useState, type KeyboardEvent, type MouseEvent } from "react";

import { TabTitleInput } from "./TabTitleInput";
import { describeStatus, type TabStatus, type TerminalTab } from "./terminal-store";

interface TerminalTabsProps {
  tabs: readonly TerminalTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

const STATUS_DOT_CLASS: Record<TabStatus["kind"], string> = {
  starting: "bg-warning",
  running: "bg-success",
  exited: "bg-fg-subtle",
  failed: "bg-danger",
};

export function TerminalTabs({ tabs, activeId, onSelect, onClose, onRename }: TerminalTabsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const finishRename = (id: string, title: string) => {
    onRename(id, title);
    setEditingId(null);
  };

  return (
    <div role="tablist" aria-label="Terminals" className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {tabs.map((tab) =>
        editingId === tab.id ? (
          <TabTitleInput
            key={tab.id}
            initialTitle={tab.title}
            onCommit={(title) => {
              finishRename(tab.id, title);
            }}
            onCancel={() => {
              setEditingId(null);
            }}
          />
        ) : (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            onSelect={onSelect}
            onClose={onClose}
            onStartRename={setEditingId}
          />
        ),
      )}
    </div>
  );
}

interface TabItemProps {
  tab: TerminalTab;
  active: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onStartRename: (id: string) => void;
}

function TabItem({ tab, active, onSelect, onClose, onStartRename }: TabItemProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "F2") onStartRename(tab.id);
  };

  const handleAuxClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button === 1) onClose(tab.id);
  };

  return (
    <div
      role="presentation"
      className={`flex h-6 shrink-0 items-center rounded-sm text-xs transition-colors ${
        active ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        title={`${tab.title} (${describeStatus(tab.status)}). Double-click or F2 to rename.`}
        onClick={() => {
          onSelect(tab.id);
        }}
        onDoubleClick={() => {
          onStartRename(tab.id);
        }}
        onKeyDown={handleKeyDown}
        onAuxClick={handleAuxClick}
        className="flex h-full max-w-40 items-center gap-1.5 pr-1 pl-2"
      >
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[tab.status.kind]}`} />
        <span className="truncate">{tab.title}</span>
      </button>
      <button
        type="button"
        aria-label={`Close ${tab.title}`}
        onClick={() => {
          onClose(tab.id);
        }}
        className="mr-1 inline-flex size-4 items-center justify-center rounded-sm text-fg-subtle hover:bg-surface-1 hover:text-fg"
      >
        <X aria-hidden className="size-3" />
      </button>
    </div>
  );
}
