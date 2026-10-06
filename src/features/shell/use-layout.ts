import { useStore } from "zustand";

import { createSafeStorage } from "@/shared/lib/safe-storage";

import { createLayoutStore, type LayoutState } from "./layout-store";

const layoutStore = createLayoutStore(createSafeStorage(() => window.localStorage));

export function useLayout<T>(selector: (state: LayoutState) => T): T {
  return useStore(layoutStore, selector);
}
