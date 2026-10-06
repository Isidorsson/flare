import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { createSafeStorage, type KeyValueStorage } from "./safe-storage";

let warn: ReturnType<typeof spyOn<Console, "warn">>;

beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

function throwingStorage(): KeyValueStorage {
  const fail = (): never => {
    throw new Error("denied");
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

describe("createSafeStorage", () => {
  test("passes reads and writes through to the underlying storage", () => {
    const data = new Map<string, string>();
    const storage = createSafeStorage(() => ({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    }));

    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBe("v");
    storage.removeItem("k");
    expect(storage.getItem("k")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test("reports failures with a warning instead of throwing", () => {
    const storage = createSafeStorage(throwingStorage);

    expect(storage.getItem("k")).toBeNull();
    expect(() => storage.setItem("k", "v")).not.toThrow();
    expect(() => storage.removeItem("k")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  test("handles the storage accessor itself throwing", () => {
    const storage = createSafeStorage(() => {
      throw new Error("SecurityError");
    });

    expect(storage.getItem("k")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
