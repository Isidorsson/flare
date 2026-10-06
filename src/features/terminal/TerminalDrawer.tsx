import { ChevronDown, ChevronUp, OctagonX, Plus, SquareTerminal } from "lucide-react";

import { TERMINAL_HEADER_HEIGHT } from "@/features/shell/layout-constants";
import { useWorkspace } from "@/features/workspace/use-workspace";
import type { SizeBounds } from "@/shared/lib/splitter-math";
import { EmptyState } from "@/shared/ui/EmptyState";
import { IconButton } from "@/shared/ui/IconButton";
import { Splitter } from "@/shared/ui/Splitter";
import { Tooltip } from "@/shared/ui/Tooltip";

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
        <Tooltip
          content={open ? "Collapse the terminal" : "Open the terminal"}
          detail={!open && tabs.length === 0 ? "Starts a new shell" : undefined}
          side="top"
        >
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
        </Tooltip>
        {open && (
          <TerminalTabs
            tabs={tabs}
            activeId={activeId}
            onSelect={setActive}
            onClose={terminalController.closeTab}
            onRename={renameTab}
          />
        )}
        {open && <IconButton icon={Plus} label="Open a new terminal" side="top" onClick={terminalController.openTab} />}
        <span className="flex-1" />
        <DrawerActions open={open} hasTabs={tabs.length > 0} onToggle={handleToggle} />
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

interface DrawerActionsProps {
  open: boolean;
  hasTabs: boolean;
  onToggle: () => void;
}

function DrawerActions({ open, hasTabs, onToggle }: DrawerActionsProps) {
  return (
    <>
      <IconButton
        icon={OctagonX}
        label="Close all terminals"
        side="top"
        disabledReason={hasTabs ? undefined : "No terminals are open"}
        onClick={terminalController.closeAll}
      />
      <IconButton
        icon={open ? ChevronDown : ChevronUp}
        label={open ? "Collapse the terminal" : "Expand the terminal"}
        side="top"
        aria-expanded={open}
        aria-controls={BODY_ID}
        onClick={onToggle}
      />
    </>
  );
}

function NoTerminals() {
  const root = useWorkspace((state) => state.root);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <EmptyState
        icon={SquareTerminal}
        title="No terminal session"
        description="Shells you start for this project will run here."
      />
      <Tooltip content="Start a new shell" detail={root === null ? undefined : `Starts in ${root}`} side="top">
        <button
          type="button"
          onClick={terminalController.openTab}
          className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-3"
        >
          New terminal
        </button>
      </Tooltip>
    </div>
  );
}
