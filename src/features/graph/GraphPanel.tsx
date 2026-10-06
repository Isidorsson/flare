import { Network } from "lucide-react";
import { useEffect } from "react";

import { useWorkspace } from "@/features/workspace/use-workspace";
import { EmptyState } from "@/shared/ui/EmptyState";

import { GraphCanvas } from "./GraphCanvas";
import { GraphFooter } from "./GraphFooter";
import { GraphMessages } from "./GraphMessages";
import { GraphToolbar } from "./GraphToolbar";
import { subscribeToGraphChanges } from "./graph-events";
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

  useEffect(() => {
    void graphStore.getState().load(root);
  }, [root]);

  useEffect(() => {
    const subscription = subscribeToGraphChanges(() => {
      void graphStore.getState().refresh();
    });
    return () => {
      subscription.cancel();
    };
  }, []);

  function handleNodeClick(id: string) {
    const state = graphStore.getState();
    if (state.mode === "blast") {
      void state.inspectBlast(id);
      return;
    }
    onOpenFile?.(toAbsolutePath(root, id));
  }

  return (
    <div className="relative size-full overflow-hidden bg-bg">
      {hasNodes ? <GraphCanvas store={graphStore} onNodeClick={handleNodeClick} /> : null}
      <GraphMessages />
      <GraphToolbar />
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
