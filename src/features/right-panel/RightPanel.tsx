import { openFile } from "@/features/files";
import { FilesPanel } from "@/features/files/FilesPanel";
import { GraphPanel } from "@/features/graph/GraphPanel";
import type { SizeBounds } from "@/shared/lib/splitter-math";
import { Splitter } from "@/shared/ui/Splitter";

interface RightPanelProps {
  graphWidth: number;
  graphBounds: SizeBounds;
  onResizeGraph: (px: number) => void;
}

function openFromGraph(path: string) {
  openFile(path).catch((error: unknown) => {
    console.error(`flare: could not open ${path} from the graph`, error);
  });
}

export function RightPanel({ graphWidth, graphBounds, onResizeGraph }: RightPanelProps) {
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
