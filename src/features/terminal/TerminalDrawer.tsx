import { ChevronDown, ChevronUp, SquareTerminal } from "lucide-react";

import { TERMINAL_HEADER_HEIGHT } from "@/features/shell/layout-constants";
import type { SizeBounds } from "@/shared/lib/splitter-math";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Splitter } from "@/shared/ui/Splitter";

interface TerminalDrawerProps {
  open: boolean;
  height: number;
  bounds: SizeBounds;
  onToggle: () => void;
  onResize: (height: number) => void;
}

const BODY_ID = "terminal-body";

export function TerminalDrawer({ open, height, bounds, onToggle, onResize }: TerminalDrawerProps) {
  const ToggleIcon = open ? ChevronDown : ChevronUp;
  return (
    <section aria-label="Terminal" className="relative shrink-0 border-t border-border bg-surface-1">
      {open && (
        <Splitter edge="top" label="Resize terminal" value={height} bounds={bounds} onResize={onResize} />
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={BODY_ID}
        onClick={onToggle}
        style={{ height: TERMINAL_HEADER_HEIGHT }}
        className="flex w-full items-center gap-2 px-3 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <SquareTerminal aria-hidden className="size-4" />
        <span className="flex-1 text-left">Terminal</span>
        <ToggleIcon aria-hidden className="size-4" />
      </button>
      <div
        id={BODY_ID}
        hidden={!open}
        style={{ height }}
        className="flex items-center justify-center border-t border-border bg-bg"
      >
        <EmptyState
          icon={SquareTerminal}
          title="No terminal session"
          description="Shells you start for this project will run here."
        />
      </div>
    </section>
  );
}
