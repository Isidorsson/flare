import { FolderTree, Network, type LucideIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

import { openFile } from "@/features/files";
import { FilesPanel } from "@/features/files/FilesPanel";
import { GraphPanel } from "@/features/graph/GraphPanel";
import { RIGHT_TABS, type RightTab } from "@/features/shell/layout-constants";
import { useLayout } from "@/features/shell/use-layout";

interface TabDefinition {
  label: string;
  icon: LucideIcon;
}

const TABS: Record<RightTab, TabDefinition> = {
  files: { label: "Files", icon: FolderTree },
  graph: { label: "Graph", icon: Network },
};

const tabId = (tab: RightTab) => `right-tab-${tab}`;
const panelId = (tab: RightTab) => `right-panel-${tab}`;

function neighbourTab(current: RightTab, key: string): RightTab | null {
  const count = RIGHT_TABS.length;
  const index = RIGHT_TABS.indexOf(current);
  if (key === "ArrowRight") return RIGHT_TABS[(index + 1) % count] ?? null;
  if (key === "ArrowLeft") return RIGHT_TABS[(index - 1 + count) % count] ?? null;
  if (key === "Home") return RIGHT_TABS[0];
  if (key === "End") return RIGHT_TABS[count - 1] ?? null;
  return null;
}

function TabButton({ tab, selected, onSelect }: { tab: RightTab; selected: boolean; onSelect: () => void }) {
  const { label, icon: Icon } = TABS[tab];
  const tone = selected ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg";
  return (
    <button
      id={tabId(tab)}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={panelId(tab)}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={`-mb-px flex h-9 items-center gap-2 border-b-2 px-3 text-sm transition-colors ${tone}`}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </button>
  );
}

export function RightPanel() {
  const activeTab = useLayout((state) => state.rightTab);
  const setRightTab = useLayout((state) => state.setRightTab);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = neighbourTab(activeTab, event.key);
    if (next === null) return;
    event.preventDefault();
    setRightTab(next);
    document.getElementById(tabId(next))?.focus();
  }

  function openFromGraph(path: string) {
    setRightTab("files");
    openFile(path).catch((error: unknown) => {
      console.error(`flare: could not open ${path} from the graph`, error);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div
        role="tablist"
        aria-label="Inspector tabs"
        onKeyDown={handleKeyDown}
        className="flex h-11 shrink-0 items-end gap-1 border-b border-border px-2"
      >
        {RIGHT_TABS.map((tab) => (
          <TabButton
            key={tab}
            tab={tab}
            selected={tab === activeTab}
            onSelect={() => {
              setRightTab(tab);
            }}
          />
        ))}
      </div>
      <div
        role="tabpanel"
        id={panelId(activeTab)}
        aria-labelledby={tabId(activeTab)}
        className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto"
      >
        {activeTab === "files" ? <FilesPanel /> : <GraphPanel onOpenFile={openFromGraph} />}
      </div>
    </div>
  );
}
