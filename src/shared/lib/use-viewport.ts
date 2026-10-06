import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
  };
}

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, () => window.innerWidth);
}

export function useViewportHeight(): number {
  return useSyncExternalStore(subscribe, () => window.innerHeight);
}
