import { useEffect, useEffectEvent, useRef } from "react";

import { GraphScene } from "./graph-scene";
import type { GraphStore } from "./graph-store";

interface GraphCanvasProps {
  store: GraphStore;
  onNodeClick: (id: string) => void;
}

function createScene(container: HTMLElement, store: GraphStore, onNodeClick: (id: string) => void) {
  try {
    return GraphScene.start({ container, store, onNodeClick });
  } catch (error) {
    store.getState().reportFailure(error);
    return null;
  }
}

export function GraphCanvas({ store, onNodeClick }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleNodeClick = useEffectEvent(onNodeClick);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const scene = createScene(container, store, (id) => {
      handleNodeClick(id);
    });
    return () => {
      scene?.dispose();
    };
  }, [store]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
