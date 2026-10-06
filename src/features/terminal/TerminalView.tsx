import { TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";

import { EmptyState } from "@/shared/ui/EmptyState";

import type { TerminalTab } from "./terminal-store";
import { terminalController } from "./use-terminal";

interface TerminalViewProps {
  tab: TerminalTab;
  visible: boolean;
}

export function TerminalView({ tab, visible }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { id, status } = tab;
  const ready = status.kind === "running" || status.kind === "exited";

  useEffect(() => {
    const container = containerRef.current;
    const session = terminalController.getSession(id);
    if (!ready || !container || !session) return undefined;
    return session.mount(container);
  }, [id, ready]);

  useEffect(() => {
    if (ready && visible) terminalController.getSession(id)?.focus();
  }, [id, ready, visible]);

  return (
    // The shell sets select-none on the app root; the terminal's input textarea must stay selectable.
    <div hidden={!visible} className="absolute inset-0 select-text">
      <div ref={containerRef} className="absolute inset-0" />
      {status.kind === "starting" && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-fg-subtle">
          Starting shell…
        </p>
      )}
      {status.kind === "failed" && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg">
          <EmptyState icon={TriangleAlert} title="Could not start the terminal" description={status.message} />
        </div>
      )}
    </div>
  );
}
