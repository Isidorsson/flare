import { workspaceStore } from "@/features/workspace/use-workspace";

import { subscribeToGraphChanges } from "./graph-events";
import { graphStore } from "./use-graph";

/** Keeps the graph indexed for the open workspace even while no graph view is mounted. */
export function startGraphRuntime(): () => void {
  let loadedRoot: string | null = null;
  const sync = (root: string | null) => {
    if (root === loadedRoot) return;
    loadedRoot = root;
    if (root !== null) void graphStore.getState().load(root);
  };
  sync(workspaceStore.getState().root);
  const unsubscribeWorkspace = workspaceStore.subscribe((state) => {
    sync(state.root);
  });
  const changes = subscribeToGraphChanges(() => {
    void graphStore.getState().refresh();
  });
  return () => {
    unsubscribeWorkspace();
    changes.cancel();
  };
}
