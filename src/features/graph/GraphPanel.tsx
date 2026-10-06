import { Network } from "lucide-react";

import { useWorkspace } from "@/features/workspace/use-workspace";
import { EmptyState } from "@/shared/ui/EmptyState";

import { GraphCanvas } from "./GraphCanvas";
import { GraphFooter } from "./GraphFooter";
import { GraphInspector } from "./GraphInspector";
import { GraphMessages } from "./GraphMessages";
import { GraphToolbar } from "./GraphToolbar";
import { isFolderId } from "./directory-tree";
import { toAbsolutePath } from "./graph-paths";
import { graphStore, useGraph } from "./use-graph";

export interface GraphPanelProps {
  onOpenFile?: ((path: string) => void) | undefined;
}

interface GraphViewProps extends GraphPanelProps {
  root: string;
}

function GraphView({ root, onOpenFile }: GraphViewProps) {
  const hasNodes = useGraph((state) => (state.snapshot?.nodes.length ?? 0) > 0);

  function handleNodeClick(id: string) {
    if (!isFolderId(id)) graphStore.getState().select(id);
  }

  function openFile(id: string) {
    if (!isFolderId(id)) onOpenFile?.(toAbsolutePath(root, id));
  }

  return (
    <div className="flex size-full flex-col overflow-hidden bg-bg">
      <GraphToolbar />
      <div className="relative min-h-0 flex-1">
        {hasNodes ? (
          <GraphCanvas
            store={graphStore}
            onNodeClick={handleNodeClick}
            onNodeOpen={openFile}
            onStageClick={() => {
              graphStore.getState().select(null);
            }}
          />
        ) : null}
        <GraphMessages />
        {hasNodes ? <GraphInspector onOpenFile={openFile} /> : null}
      </div>
      {hasNodes ? <GraphFooter /> : null}
    </div>
  );
}

export function GraphPanel({ onOpenFile }: GraphPanelProps) {
  const root = useWorkspace((state) => state.root);
  if (root === null) {
    return (
      <EmptyState
        icon={Network}
        title="No graph yet"
        description="Open a project to see how its files import each other and where the agent is working."
      />
    );
  }
  return <GraphView key={root} root={root} onOpenFile={onOpenFile} />;
}
