import { Columns2, FolderTree, Network, type LucideIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

import { openFile } from "@/features/files";
import { FilesPanel } from "@/features/files/FilesPanel";
import { GraphPanel } from "@/features/graph/GraphPanel";
import { RIGHT_VIEWS, type RightView } from "@/features/shell/layout-constants";
import { useLayout } from "@/features/shell/use-layout";
import type { SizeBounds } from "@/shared/lib/splitter-math";
import { Splitter } from "@/shared/ui/Splitter";

interface ViewDefinition {
  label: string;
  hint: string;
  icon: LucideIcon;
}

const VIEWS: Record<RightView, ViewDefinition> = {
  files: { label: "Files", hint: "File tree and editor", icon: FolderTree },
  graph: { label: "Graph", hint: "Code graph of imports and agent activity", icon: Network },
  split: { label: "Split", hint: "Files and graph side by side", icon: Columns2 },
};

const tabId = (view: RightView) => `right-tab-${view}`;
const PANEL_ID = "right-panel-view";

function neighbourView(current: RightView, key: string): RightView | null {
  const count = RIGHT_VIEWS.length;
  const index = RIGHT_VIEWS.indexOf(current);
  if (key === "ArrowRight") return RIGHT_VIEWS[(index + 1) % count] ?? null;
  if (key === "ArrowLeft") return RIGHT_VIEWS[(index - 1 + count) % count] ?? null;
  if (key === "Home") return RIGHT_VIEWS[0];
  if (key === "End") return RIGHT_VIEWS[count - 1] ?? null;
  return null;
}

function openFromGraph(path: string) {
  openFile(path).catch((error: unknown) => {
    console.error(`flare: could not open ${path} from the graph`, error);
  });
}

function ViewTab({ view, selected, onSelect }: { view: RightView; selected: boolean; onSelect: () => void }) {
  const { label, hint, icon: Icon } = VIEWS[view];
  const tone = selected ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg";
  return (
    <button
      id={tabId(view)}
      type="button"
      role="tab"
      title={hint}
      aria-selected={selected}
      aria-controls={PANEL_ID}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={`-mb-px flex h-9 items-center gap-2 border-b-2 px-3 text-sm transition-colors ${tone}`}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </button>
  );
}

interface RightPanelProps {
  graphWidth: number;
  graphBounds: SizeBounds;
  onResizeGraph: (px: number) => void;
}

function SplitView({ graphWidth, graphBounds, onResizeGraph }: RightPanelProps) {
  return (
    <div className="flex h-full">
      <section aria-label="Files" className="min-w-0 flex-1">
        <FilesPanel />
      </section>
      <section aria-label="Code graph" style={{ width: graphWidth }} className="relative shrink-0 border-l border-border">
        <GraphPanel onOpenFile={openFromGraph} />
        <Splitter
          edge="left"
          label="Resize code graph"
          value={graphWidth}
          bounds={graphBounds}
          onResize={onResizeGraph}
        />
      </section>
    </div>
  );
}

export function RightPanel(props: RightPanelProps) {
  const view = useLayout((state) => state.rightView);
  const setRightView = useLayout((state) => state.setRightView);

  function openFromGraphView(path: string) {
    setRightView("files");
    openFromGraph(path);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = neighbourView(view, event.key);
    if (next === null) return;
    event.preventDefault();
    setRightView(next);
    document.getElementById(tabId(next))?.focus();
  }

  return (
    <div className="flex h-full flex-col">
      <div
        role="tablist"
        aria-label="Inspector views"
        onKeyDown={handleKeyDown}
        className="flex h-11 shrink-0 items-end gap-1 border-b border-border px-2"
      >
        {RIGHT_VIEWS.map((option) => (
          <ViewTab
            key={option}
            view={option}
            selected={option === view}
            onSelect={() => {
              setRightView(option);
            }}
          />
        ))}
      </div>
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(view)} className="min-h-0 flex-1">
        {view === "files" ? <FilesPanel /> : null}
        {view === "graph" ? <GraphPanel onOpenFile={openFromGraphView} /> : null}
        {view === "split" ? <SplitView {...props} /> : null}
      </div>
    </div>
  );
}
