import { useEffect, useEffectEvent, useRef } from "react";

import { GraphScene } from "./graph-scene";
import type { GraphStore } from "./graph-store";

interface GraphCanvasProps {
  store: GraphStore;
  onNodeClick: (id: string) => void;
  onNodeOpen: (id: string) => void;
  onStageClick: () => void;
}

interface SceneHandlers {
  onNodeClick: (id: string) => void;
  onNodeOpen: (id: string) => void;
  onStageClick: () => void;
}

function createScene(container: HTMLElement, store: GraphStore, handlers: SceneHandlers) {
  try {
    return GraphScene.start({ container, store, ...handlers });
  } catch (error) {
    store.getState().reportFailure(error);
    return null;
  }
}

export function GraphCanvas({ store, onNodeClick, onNodeOpen, onStageClick }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleNodeClick = useEffectEvent(onNodeClick);
  const handleNodeOpen = useEffectEvent(onNodeOpen);
  const handleStageClick = useEffectEvent(onStageClick);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const scene = createScene(container, store, {
      onNodeClick: (id) => {
        handleNodeClick(id);
      },
      onNodeOpen: (id) => {
        handleNodeOpen(id);
      },
      onStageClick: () => {
        handleStageClick();
      },
    });
    return () => {
      scene?.dispose();
    };
  }, [store]);

  return <div ref={containerRef} className="absolute inset-0 bg-bg" />;
}
