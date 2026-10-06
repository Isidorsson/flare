import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { sizeAfterDrag, sizeAfterKey, type SizeBounds, type SplitterEdge } from "../lib/splitter-math";

interface SplitterProps {
  edge: SplitterEdge;
  label: string;
  value: number;
  bounds: SizeBounds;
  onResize: (size: number) => void;
}

interface DragState {
  originPx: number;
  startSize: number;
}

const EDGE_CLASSES: Record<SplitterEdge, string> = {
  right: "inset-y-0 -right-px w-[3px] cursor-col-resize before:inset-y-0 before:-inset-x-1",
  left: "inset-y-0 -left-px w-[3px] cursor-col-resize before:inset-y-0 before:-inset-x-1",
  top: "inset-x-0 -top-px h-[3px] cursor-row-resize before:inset-x-0 before:-inset-y-1",
};

function pointerPosition(edge: SplitterEdge, event: PointerEvent): number {
  return edge === "top" ? event.clientY : event.clientX;
}

export function Splitter({ edge, label, value, bounds, onResize }: SplitterProps) {
  const [drag, setDrag] = useState<DragState | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ originPx: pointerPosition(edge, event), startSize: value });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const delta = pointerPosition(edge, event) - drag.originPx;
    onResize(sizeAfterDrag(edge, drag.startSize, delta, bounds));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = sizeAfterKey(edge, event, value, bounds);
    if (next === null) return;
    event.preventDefault();
    onResize(next);
  }

  const active = drag !== null;
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={edge === "top" ? "horizontal" : "vertical"}
      aria-valuenow={Math.round(value)}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onLostPointerCapture={() => {
        setDrag(null);
      }}
      onKeyDown={handleKeyDown}
      className={`absolute z-20 touch-none transition-colors before:absolute hover:bg-accent focus-visible:bg-accent focus-visible:outline-none ${EDGE_CLASSES[edge]} ${active ? "bg-accent" : "bg-transparent"}`}
    />
  );
}
