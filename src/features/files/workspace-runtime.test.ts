import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { batchOf, createFakeGateway, deferred } from "./fake-gateway";
import { createFilesStore } from "./files-store";
import { flush } from "./test-support";
import { startWorkspaceRuntime, type RootSource } from "./workspace-runtime";

function rootSource(initial: string | null) {
  let root = initial;
  const listeners = new Set<(state: { root: string | null }, previous: { root: string | null }) => void>();
  const source: RootSource & { setRoot: (next: string | null) => void; listenerCount: () => number } = {
    getState: () => ({ root }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setRoot: (next) => {
      const previous = { root };
      root = next;
      for (const listener of listeners) listener({ root }, previous);
    },
    listenerCount: () => listeners.size,
  };
  return source;
}

function setup(initialRoot: string | null, files: Record<string, string> = { "C:/p/a.ts": "a" }) {
  const gateway = createFakeGateway(files);
  const store = createFilesStore(gateway);
  const workspace = rootSource(initialRoot);
  const stop = startWorkspaceRuntime({ workspace, files: store, gateway });
  return { gateway, store, workspace, stop };
}

let error: ReturnType<typeof spyOn<Console, "error">>;

beforeEach(() => {
  error = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  error.mockRestore();
});

describe("startWorkspaceRuntime", () => {
  test("opens the persisted root on start and loads its listing", async () => {
    const { gateway, store } = setup("c:\\p");
    await flush();
    expect(gateway.openedRoots).toEqual(["c:\\p"]);
    expect(store.getState()).toMatchObject({ phase: "ready", root: "C:/p" });
    expect(store.getState().dirs["C:/p"]?.status).toBe("ready");
  });

  test("with no root it stays idle and closes the native workspace", async () => {
    const { gateway, store } = setup(null);
    await flush();
    expect(store.getState().phase).toBe("idle");
    expect(gateway.closed).toBe(1);
    expect(gateway.openedRoots).toEqual([]);
  });

  test("switching roots resets the store and opens the new workspace", async () => {
    const { gateway, store, workspace } = setup("C:/p", { "C:/p/a.ts": "a", "C:/q/b.ts": "b" });
    await flush();
    await store.getState().openFile("C:/p/a.ts");
    workspace.setRoot("C:/q");
    expect(store.getState()).toMatchObject({ phase: "opening", files: {}, tabs: [] });
    await flush();
    expect(gateway.openedRoots).toEqual(["C:/p", "C:/q"]);
    expect(store.getState()).toMatchObject({ phase: "ready", root: "C:/q" });
  });

  test("a slow open for a stale root cannot overwrite the newer workspace", async () => {
    const { gateway, store, workspace } = setup(null);
    await flush();
    const slow = deferred<string>();
    gateway.openWorkspace = (root) => {
      gateway.openedRoots.push(root);
      return root === "C:/slow" ? slow.promise : Promise.resolve(root);
    };
    workspace.setRoot("C:/slow");
    workspace.setRoot("C:/fast");
    await flush();
    slow.resolve("C:/slow");
    await flush();
    expect(store.getState()).toMatchObject({ phase: "ready", root: "C:/fast" });
  });

  test("an open failure is surfaced on the store", async () => {
    const { gateway, store, workspace } = setup(null);
    await flush();
    gateway.openWorkspace = () => Promise.reject(new Error("not found: C:/gone"));
    workspace.setRoot("C:/gone");
    await flush();
    expect(store.getState()).toMatchObject({ phase: "error", workspaceError: "not found: C:/gone" });
  });

  test("forwards watcher batches into the store", async () => {
    const { gateway, store } = setup("C:/p");
    await flush();
    await store.getState().openFile("C:/p/a.ts");
    gateway.disk.set("C:/p/a.ts", "changed");
    gateway.emit(batchOf("C:/p", ["C:/p/a.ts", "modify"]));
    await flush();
    expect(store.getState().files["C:/p/a.ts"]?.draft).toBe("changed");
  });

  test("stopping unsubscribes from both the watcher and the workspace store", async () => {
    const { gateway, workspace, stop } = setup("C:/p");
    await flush();
    await stop();
    expect(gateway.unsubscribed).toBe(1);
    expect(gateway.batchListeners.size).toBe(0);
    expect(workspace.listenerCount()).toBe(0);
  });

  test("a failed watcher subscription is logged and does not break the workspace", async () => {
    const gateway = createFakeGateway({ "C:/p/a.ts": "a" });
    gateway.subscribe = () => Promise.reject(new Error("no ipc"));
    const store = createFilesStore(gateway);
    const stop = startWorkspaceRuntime({ workspace: rootSource("C:/p"), files: store, gateway });
    await flush();
    expect(store.getState().phase).toBe("ready");
    expect(error).toHaveBeenCalled();
    await stop();
  });
});
