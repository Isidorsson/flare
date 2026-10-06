import { ChevronDown, ChevronUp, Plus, SquareTerminal } from "lucide-react";

import { TERMINAL_HEADER_HEIGHT } from "@/features/shell/layout-constants";
import type { SizeBounds } from "@/shared/lib/splitter-math";
import { EmptyState } from "@/shared/ui/EmptyState";
import { IconButton } from "@/shared/ui/IconButton";
import { Splitter } from "@/shared/ui/Splitter";

import { TerminalTabs } from "./TerminalTabs";
import { TerminalView } from "./TerminalView";
import { terminalController, useTerminal } from "./use-terminal";

interface TerminalDrawerProps {
  open: boolean;
  height: number;
  bounds: SizeBounds;
  onToggle: () => void;
  onResize: (height: number) => void;
}

const BODY_ID = "terminal-body";

export function TerminalDrawer({ open, height, bounds, onToggle, onResize }: TerminalDrawerProps) {
  const tabs = useTerminal((state) => state.tabs);
  const activeId = useTerminal((state) => state.activeId);
  const setActive = useTerminal((state) => state.setActive);
  const renameTab = useTerminal((state) => state.renameTab);
  const ToggleIcon = open ? ChevronDown : ChevronUp;

  const handleToggle = () => {
    if (!open && tabs.length === 0) terminalController.openTab();
    onToggle();
  };

  return (
    <section aria-label="Terminal" className="relative shrink-0 border-t border-border bg-surface-1">
      {open && (
        <Splitter edge="top" label="Resize terminal" value={height} bounds={bounds} onResize={onResize} />
      )}
      <div style={{ height: TERMINAL_HEADER_HEIGHT }} className="flex items-center gap-1 pr-1.5 pl-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={BODY_ID}
          onClick={handleToggle}
          className="flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <SquareTerminal aria-hidden className="size-4" />
          Terminal
        </button>
        {open && (
          <TerminalTabs
            tabs={tabs}
            activeId={activeId}
            onSelect={setActive}
            onClose={terminalController.closeTab}
            onRename={renameTab}
          />
        )}
        {open && <IconButton icon={Plus} label="New terminal" onClick={terminalController.openTab} />}
        <span className="flex-1" />
        <IconButton
          icon={ToggleIcon}
          label={open ? "Collapse terminal" : "Expand terminal"}
          aria-expanded={open}
          aria-controls={BODY_ID}
          onClick={handleToggle}
        />
      </div>
      <div
        id={BODY_ID}
        hidden={!open}
        style={{ height }}
        className="relative border-t border-border bg-bg"
      >
        {tabs.length === 0 ? (
          <NoTerminals />
        ) : (
          tabs.map((tab) => <TerminalView key={tab.id} tab={tab} visible={open && tab.id === activeId} />)
        )}
      </div>
    </section>
  );
}

function NoTerminals() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <EmptyState
        icon={SquareTerminal}
        title="No terminal session"
        description="Shells you start for this project will run here."
      />
      <button
        type="button"
        onClick={terminalController.openTab}
        className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-3"
      >
        New terminal
      </button>
    </div>
  );
}
