import { ChatPane } from "@/features/chat/ChatPane";
import { RightPanel } from "@/features/right-panel/RightPanel";
import { TerminalDrawer } from "@/features/terminal/TerminalDrawer";
import { ThreadsSidebar } from "@/features/threads/ThreadsSidebar";
import { useViewportHeight, useViewportWidth } from "@/shared/lib/use-viewport";
import { Splitter } from "@/shared/ui/Splitter";

import { resolveLayout } from "./resolve-layout";
import { useLayout } from "./use-layout";

export function AppShell() {
  const sidebarWidth = useLayout((state) => state.sidebarWidth);
  const rightWidth = useLayout((state) => state.rightWidth);
  const graphWidth = useLayout((state) => state.graphWidth);
  const terminalHeight = useLayout((state) => state.terminalHeight);
  const terminalOpen = useLayout((state) => state.terminalOpen);
  const setSidebarWidth = useLayout((state) => state.setSidebarWidth);
  const setRightWidth = useLayout((state) => state.setRightWidth);
  const setGraphWidth = useLayout((state) => state.setGraphWidth);
  const setTerminalHeight = useLayout((state) => state.setTerminalHeight);
  const toggleTerminal = useLayout((state) => state.toggleTerminal);
  const viewportWidth = useViewportWidth();
  const viewportHeight = useViewportHeight();

  const layout = resolveLayout(
    { sidebarWidth, rightWidth, graphWidth, terminalHeight },
    { width: viewportWidth, height: viewportHeight },
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg text-fg select-none">
      <aside
        aria-label="Threads sidebar"
        style={{ width: layout.sidebar }}
        className="relative shrink-0 border-r border-border bg-surface-1"
      >
        <ThreadsSidebar />
        <Splitter
          edge="right"
          label="Resize threads sidebar"
          value={layout.sidebar}
          bounds={layout.bounds.sidebar}
          onResize={setSidebarWidth}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatPane />
        <TerminalDrawer
          open={terminalOpen}
          height={layout.terminal}
          bounds={layout.bounds.terminal}
          onToggle={toggleTerminal}
          onResize={setTerminalHeight}
        />
      </div>

      <aside
        aria-label="Inspector"
        style={{ width: layout.right }}
        className="relative shrink-0 border-l border-border bg-surface-1"
      >
        <RightPanel graphWidth={layout.graph} graphBounds={layout.bounds.graph} onResizeGraph={setGraphWidth} />
        <Splitter
          edge="left"
          label="Resize inspector"
          value={layout.right}
          bounds={layout.bounds.right}
          onResize={setRightWidth}
        />
      </aside>
    </div>
  );
}
