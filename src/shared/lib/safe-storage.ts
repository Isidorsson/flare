import type { StateStorage } from "zustand/middleware";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function attempt<T, F>(action: string, fallback: F, run: () => T): T | F {
  try {
    return run();
  } catch (error) {
    console.warn(`flare: storage ${action} failed, continuing without persistence`, error);
    return fallback;
  }
}

export function createSafeStorage(getStorage: () => KeyValueStorage): StateStorage {
  return {
    getItem: (name) => attempt(`read of "${name}"`, null, () => getStorage().getItem(name)),
    setItem: (name, value) => {
      attempt(`write of "${name}"`, undefined, () => {
        getStorage().setItem(name, value);
      });
    },
    removeItem: (name) => {
      attempt(`removal of "${name}"`, undefined, () => {
        getStorage().removeItem(name);
      });
    },
  };
}
