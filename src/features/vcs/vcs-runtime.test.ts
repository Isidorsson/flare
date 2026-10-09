import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { createFakeScheduler } from "@/features/files/live/fake-scheduler";

import { createFakeGateway, file, repoStatus } from "./fake-gateway";
import { REFRESH_QUIET_MS } from "./refresh-scheduler";
import { startVcsRuntime, type RootSource } from "./vcs-runtime";
import { createVcsStore } from "./vcs-store";

type RootListener = Parameters<RootSource["subscribe"]>[0];

function rootSource(initial: string | null) {
  let root = initial;
  const listeners = new Set<RootListener>();
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

function setup(initialRoot: string | null, subscribeFails = false) {
  const fake = createFakeGateway({ status: repoStatus({ files: [file("a.ts", null, "modified")] }) });
  const store = createVcsStore({ gateway: fake.gateway });
  const workspace = rootSource(initialRoot);
  const timers = createFakeScheduler();
  const watchers = new Set<() => void>();
  const focusListeners = new Set<() => void>();
  let unsubscribed = 0;
  const stop = startVcsRuntime({
    workspace,
    store,
    timers,
    subscribeChanges: (onChange) => {
      if (subscribeFails) return Promise.reject(new Error("no watcher"));
      watchers.add(onChange);
      return Promise.resolve(() => {
        watchers.delete(onChange);
        unsubscribed += 1;
        return Promise.resolve();
      });
    },
    onFocus: (listener) => {
      focusListeners.add(listener);
      return () => {
        focusListeners.delete(listener);
      };
    },
  });
  const settle = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  return {
    ...fake,
    store,
    workspace,
    timers,
    stop,
    settle,
    fileChanged: () => {
      for (const watcher of watchers) watcher();
    },
    windowFocused: () => {
      for (const listener of focusListeners) listener();
    },
    watcherCount: () => watchers.size,
    focusCount: () => focusListeners.size,
    unsubscribed: () => unsubscribed,
  };
}

let error: ReturnType<typeof spyOn<Console, "error">>;

beforeEach(() => {
  error = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  error.mockRestore();
});

describe("startVcsRuntime", () => {
  test("reads the status of the persisted folder on start", async () => {
    const { calls, store, settle } = setup("C:/p");
    await settle();
    expect(calls).toEqual(["status"]);
    expect(store.getState().root).toBe("C:/p");
    expect(store.getState().status?.files).toHaveLength(1);
  });

  test("with no folder it asks git nothing", async () => {
    const { calls, settle } = setup(null);
    await settle();
    expect(calls).toEqual([]);
  });

  test("follows the workspace to another folder", async () => {
    const { calls, store, workspace, settle } = setup("C:/p");
    await settle();
    workspace.setRoot("C:/q");
    await settle();
    expect(store.getState().root).toBe("C:/q");
    expect(calls).toEqual(["status", "status"]);
  });

  test("file changes are folded into one status read after things go quiet", async () => {
    const { calls, fileChanged, timers, settle } = setup("C:/p");
    await settle();
    fileChanged();
    timers.advance(REFRESH_QUIET_MS / 2);
    fileChanged();
    fileChanged();
    expect(calls).toEqual(["status"]);
    timers.advance(REFRESH_QUIET_MS);
    await settle();
    expect(calls).toEqual(["status", "status"]);
  });

  test("gh is asked once for a folder and never again by file changes or window focus", async () => {
    const { ghCalls, fileChanged, windowFocused, timers, settle } = setup("C:/p");
    await settle();
    expect(ghCalls).toEqual(["prInfo"]);
    fileChanged();
    timers.advance(REFRESH_QUIET_MS);
    await settle();
    windowFocused();
    timers.advance(REFRESH_QUIET_MS);
    await settle();
    expect(ghCalls).toEqual(["prInfo"]);
  });

  test("regaining window focus reads the status, which is how git run in a terminal shows up", async () => {
    const { calls, windowFocused, timers, settle } = setup("C:/p");
    await settle();
    windowFocused();
    timers.advance(REFRESH_QUIET_MS);
    await settle();
    expect(calls).toEqual(["status", "status"]);
  });

  test("changing folder drops a refresh that was waiting for the old one", async () => {
    const { calls, fileChanged, workspace, timers, settle } = setup("C:/p");
    await settle();
    fileChanged();
    workspace.setRoot(null);
    timers.advance(REFRESH_QUIET_MS * 2);
    await settle();
    expect(calls).toEqual(["status"]);
  });

  test("a watcher that cannot be started is reported and the rest keeps working", async () => {
    const { calls, windowFocused, timers, settle } = setup("C:/p", true);
    await settle();
    expect(error).toHaveBeenCalled();
    windowFocused();
    timers.advance(REFRESH_QUIET_MS);
    await settle();
    expect(calls).toEqual(["status", "status"]);
  });

  test("stopping removes every listener and cancels what was pending", async () => {
    const { calls, stop, fileChanged, workspace, timers, settle, watcherCount, focusCount, unsubscribed } = setup("C:/p");
    await settle();
    fileChanged();
    await stop();

    expect(workspace.listenerCount()).toBe(0);
    expect(focusCount()).toBe(0);
    expect(watcherCount()).toBe(0);
    expect(unsubscribed()).toBe(1);
    timers.advance(REFRESH_QUIET_MS * 2);
    await settle();
    expect(calls).toEqual(["status"]);
  });
});
