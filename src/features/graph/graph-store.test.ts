import { beforeEach, describe, expect, test } from "bun:test";

import { blastRole } from "./appearance";
import type { GraphApi } from "./graph-api";
import { createGraphStore, type GraphStore } from "./graph-store";
import type { BlastRadius, GraphSnapshot } from "./graph-types";
import { PULSE_DURATION_MS } from "./pulse";

const ROOT = "C:\\Users\\me\\app";

function makeSnapshot(ids: readonly string[], edges: readonly [string, string][] = []): GraphSnapshot {
  return {
    root: "C:/Users/me/app",
    nodes: ids.map((id) => ({ id, language: "typescript" })),
    edges: edges.map(([source, target]) => ({ source, target })),
    warnings: [],
  };
}

function nodeIds(store: GraphStore): string[] {
  return store.getState().snapshot?.nodes.map((node) => node.id) ?? [];
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface Harness {
  store: GraphStore;
  api: GraphApi;
  buildCalls: string[];
  blastCalls: string[];
  clock: { now: number };
  withApi: (overrides: Partial<GraphApi>) => GraphStore;
}

function harness(): Harness {
  const buildCalls: string[] = [];
  const blastCalls: string[] = [];
  const defaultSnapshot = makeSnapshot(["src/a.ts", "src/b.ts", "src/c.ts"], [["src/a.ts", "src/b.ts"]]);
  const api: GraphApi = {
    build: (root) => {
      buildCalls.push(root);
      return Promise.resolve(defaultSnapshot);
    },
    snapshot: () => Promise.resolve(defaultSnapshot),
    blastRadius: (path) => {
      blastCalls.push(path);
      return Promise.resolve({ origin: path, nodes: [{ id: "src/a.ts", depth: 1 }] });
    },
    updateFile: () => Promise.resolve("unchanged"),
    removeFile: () => Promise.resolve("unchanged"),
  };
  const clock = { now: 1000 };
  const withApi = (overrides: Partial<GraphApi>) =>
    createGraphStore({ api: { ...api, ...overrides }, now: () => clock.now });
  return { store: withApi({}), api, buildCalls, blastCalls, clock, withApi };
}

let h: Harness;

beforeEach(() => {
  h = harness();
});

describe("loading", () => {
  test("starts idle with no root", () => {
    const state = h.store.getState();
    expect(state.status).toBe("idle");
    expect(state.root).toBeNull();
    expect(state.snapshot).toBeNull();
  });

  test("builds the graph and exposes the snapshot", async () => {
    await h.store.getState().load(ROOT);
    const state = h.store.getState();
    expect(state.status).toBe("ready");
    expect(state.root).toBe(ROOT);
    expect(nodeIds(h.store)).toHaveLength(3);
    expect(h.buildCalls).toEqual([ROOT]);
  });

  test("is idempotent for the same root while loading or ready", async () => {
    const first = h.store.getState().load(ROOT);
    const second = h.store.getState().load(ROOT);
    await Promise.all([first, second]);
    await h.store.getState().load(ROOT);
    expect(h.buildCalls).toEqual([ROOT]);
  });

  test("reports build failures without throwing", async () => {
    const store = h.withApi({ build: () => Promise.reject(new Error("cannot index workspace root X")) });
    await store.getState().load(ROOT);
    const state = store.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("cannot index workspace root X");
    expect(state.snapshot).toBeNull();
  });

  test("a failed load can be retried", async () => {
    let attempts = 0;
    const store = h.withApi({
      build: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error("nope")) : Promise.resolve(makeSnapshot(["a.ts"]));
      },
    });
    await store.getState().load(ROOT);
    expect(store.getState().status).toBe("error");
    await store.getState().load(ROOT);
    expect(store.getState().status).toBe("ready");
    expect(store.getState().error).toBeNull();
  });

  test("switching roots discards the previous graph and ignores its late response", async () => {
    const slow = deferred<GraphSnapshot>();
    let call = 0;
    const store = h.withApi({
      build: () => {
        call += 1;
        return call === 1 ? slow.promise : Promise.resolve(makeSnapshot(["new.ts"]));
      },
    });
    const first = store.getState().load("C:/one");
    await store.getState().load("C:/two");
    slow.resolve(makeSnapshot(["stale.ts"]));
    await first;
    expect(store.getState().root).toBe("C:/two");
    expect(nodeIds(store)).toEqual(["new.ts"]);
  });

  test("reindex keeps the current graph visible while rebuilding", async () => {
    const later = deferred<GraphSnapshot>();
    let call = 0;
    const store = h.withApi({
      build: () => {
        call += 1;
        return call === 1 ? Promise.resolve(makeSnapshot(["old.ts"])) : later.promise;
      },
    });
    await store.getState().load(ROOT);
    const pending = store.getState().reindex();
    expect(store.getState().status).toBe("loading");
    expect(nodeIds(store)).toEqual(["old.ts"]);
    later.resolve(makeSnapshot(["fresh.ts"]));
    await pending;
    expect(store.getState().status).toBe("ready");
    expect(nodeIds(store)).toEqual(["fresh.ts"]);
  });

  test("reindex without a root does nothing", async () => {
    await h.store.getState().reindex();
    expect(h.buildCalls).toEqual([]);
    expect(h.store.getState().status).toBe("idle");
  });

  test("refresh swaps in the latest snapshot from Rust", async () => {
    const store = h.withApi({ snapshot: () => Promise.resolve(makeSnapshot(["only.ts"])) });
    await store.getState().load(ROOT);
    await store.getState().refresh();
    expect(nodeIds(store)).toEqual(["only.ts"]);
  });

  test("bursts of refreshes coalesce into one extra fetch", async () => {
    const gates = [deferred<GraphSnapshot>(), deferred<GraphSnapshot>()];
    let fetches = 0;
    const store = h.withApi({
      snapshot: () => {
        const gate = gates[fetches];
        fetches += 1;
        return gate === undefined ? Promise.resolve(makeSnapshot(["late.ts"])) : gate.promise;
      },
    });
    await store.getState().load(ROOT);
    const running = store.getState().refresh();
    await store.getState().refresh();
    await store.getState().refresh();
    await store.getState().refresh();
    expect(fetches).toBe(1);
    gates[0]?.resolve(makeSnapshot(["first.ts"]));
    await Promise.resolve();
    await Promise.resolve();
    gates[1]?.resolve(makeSnapshot(["second.ts"]));
    await running;
    expect(fetches).toBe(2);
    expect(nodeIds(store)).toEqual(["second.ts"]);
  });

  test("a failing refresh keeps the graph and surfaces the error", async () => {
    const store = h.withApi({ snapshot: () => Promise.reject(new Error("the workspace has not been indexed yet")) });
    await store.getState().load(ROOT);
    await store.getState().refresh();
    expect(store.getState().status).toBe("ready");
    expect(store.getState().error).toBe("the workspace has not been indexed yet");
    expect(nodeIds(store)).toHaveLength(3);
  });
});

describe("pulse", () => {
  beforeEach(async () => {
    await h.store.getState().load(ROOT);
  });

  test("records a pulse for an absolute Windows path inside the root", () => {
    h.store.getState().pulse("C:\\Users\\me\\app\\src\\a.ts", "read");
    expect(h.store.getState().pulses.get("src/a.ts")).toEqual({ kind: "read", startedAt: 1000 });
  });

  test("accepts workspace-relative paths", () => {
    h.store.getState().pulse("src/b.ts", "change");
    expect(h.store.getState().pulses.get("src/b.ts")?.kind).toBe("change");
  });

  test("maps differently-cased paths onto the indexed spelling", () => {
    h.store.getState().pulse("C:/users/ME/App/SRC/A.ts", "read");
    expect([...h.store.getState().pulses.keys()]).toEqual(["src/a.ts"]);
  });

  test("ignores paths outside the workspace and the root itself", () => {
    h.store.getState().pulse("C:/elsewhere/a.ts", "read");
    h.store.getState().pulse("../escape.ts", "read");
    h.store.getState().pulse(ROOT, "read");
    expect(h.store.getState().pulses.size).toBe(0);
  });

  test("keeps pulses for files the graph does not know yet", () => {
    h.store.getState().pulse("src/brand-new.ts", "change");
    expect(h.store.getState().pulses.has("src/brand-new.ts")).toBe(true);
  });

  test("ignores pulses before a workspace is loaded", () => {
    const fresh = harness().store;
    fresh.getState().pulse("src/a.ts", "read");
    expect(fresh.getState().pulses.size).toBe(0);
  });

  test("a later pulse for the same file replaces the earlier one and restarts the clock", () => {
    h.store.getState().pulse("src/a.ts", "read");
    h.clock.now = 1500;
    h.store.getState().pulse("src/a.ts", "change");
    expect(h.store.getState().pulses.get("src/a.ts")).toEqual({ kind: "change", startedAt: 1500 });
  });

  test("recording a pulse prunes expired ones", () => {
    h.store.getState().pulse("src/a.ts", "read");
    h.clock.now = 1000 + PULSE_DURATION_MS + 1;
    h.store.getState().pulse("src/b.ts", "read");
    expect([...h.store.getState().pulses.keys()]).toEqual(["src/b.ts"]);
  });

  test("expirePulses drops only the pulses that have decayed", () => {
    h.store.getState().pulse("src/a.ts", "read");
    h.clock.now = 2000;
    h.store.getState().pulse("src/b.ts", "change");
    h.store.getState().expirePulses(1000 + PULSE_DURATION_MS + 10);
    expect([...h.store.getState().pulses.keys()]).toEqual(["src/b.ts"]);
    h.store.getState().expirePulses(2000 + PULSE_DURATION_MS + 10);
    expect(h.store.getState().pulses.size).toBe(0);
  });

  test("expirePulses leaves the state untouched when nothing expired", () => {
    h.store.getState().pulse("src/a.ts", "read");
    const before = h.store.getState().pulses;
    h.store.getState().expirePulses(1001);
    expect(h.store.getState().pulses).toBe(before);
  });

  test("notifies subscribers when a pulse is recorded", () => {
    let notifications = 0;
    const unsubscribe = h.store.subscribe(() => {
      notifications += 1;
    });
    h.store.getState().pulse("src/a.ts", "read");
    unsubscribe();
    expect(notifications).toBe(1);
  });
});

describe("blast radius", () => {
  test("stores dependents by depth for the chosen file", async () => {
    await h.store.getState().load(ROOT);
    await h.store.getState().inspectBlast("src/b.ts");
    const blast = h.store.getState().blast;
    expect(blast?.origin).toBe("src/b.ts");
    expect(blast?.depths?.get("src/a.ts")).toBe(1);
    expect(h.blastCalls).toEqual(["src/b.ts"]);
  });

  test("shows a pending selection while the radius is being computed", async () => {
    const pending = deferred<BlastRadius>();
    const store = h.withApi({ blastRadius: () => pending.promise });
    await store.getState().load(ROOT);
    const request = store.getState().inspectBlast("src/b.ts");
    expect(store.getState().blast).toEqual({ origin: "src/b.ts", depths: null });
    pending.resolve({ origin: "src/b.ts", nodes: [] });
    await request;
    expect(store.getState().blast?.depths?.size).toBe(0);
  });

  test("only the most recent selection wins", async () => {
    const slow = deferred<BlastRadius>();
    let call = 0;
    const store = h.withApi({
      blastRadius: (path) => {
        call += 1;
        return call === 1 ? slow.promise : Promise.resolve({ origin: path, nodes: [{ id: "src/c.ts", depth: 2 }] });
      },
    });
    await store.getState().load(ROOT);
    const first = store.getState().inspectBlast("src/a.ts");
    await store.getState().inspectBlast("src/b.ts");
    slow.resolve({ origin: "src/a.ts", nodes: [{ id: "src/zzz.ts", depth: 1 }] });
    await first;
    expect(store.getState().blast?.origin).toBe("src/b.ts");
    expect(store.getState().blast?.depths?.get("src/c.ts")).toBe(2);
  });

  test("a failed lookup clears the selection and reports the error", async () => {
    const store = h.withApi({
      blastRadius: () => Promise.reject(new Error("src/gone.ts is not part of the graph")),
    });
    await store.getState().load(ROOT);
    await store.getState().inspectBlast("src/gone.ts");
    expect(store.getState().blast).toBeNull();
    expect(store.getState().error).toBe("src/gone.ts is not part of the graph");
  });

  test("leaving blast mode clears the selection and cancels in-flight lookups", async () => {
    const pending = deferred<BlastRadius>();
    const store = h.withApi({ blastRadius: () => pending.promise });
    await store.getState().load(ROOT);
    store.getState().setMode("blast");
    const request = store.getState().inspectBlast("src/b.ts");
    store.getState().setMode("explore");
    pending.resolve({ origin: "src/b.ts", nodes: [] });
    await request;
    expect(store.getState().mode).toBe("explore");
    expect(store.getState().blast).toBeNull();
  });

  test("entering blast mode keeps the colour mode and starts without a selection", () => {
    h.store.getState().setColorBy("directory");
    h.store.getState().setMode("blast");
    expect(h.store.getState().mode).toBe("blast");
    expect(h.store.getState().colorBy).toBe("directory");
    expect(h.store.getState().blast).toBeNull();
  });

  test("refresh recomputes the selection when its file still exists", async () => {
    await h.store.getState().load(ROOT);
    await h.store.getState().inspectBlast("src/b.ts");
    await h.store.getState().refresh();
    expect(h.blastCalls).toEqual(["src/b.ts", "src/b.ts"]);
    expect(h.store.getState().blast?.depths?.get("src/a.ts")).toBe(1);
  });

  test("refresh drops the selection when its file disappeared", async () => {
    let current = makeSnapshot(["src/a.ts", "src/b.ts"]);
    const store = h.withApi({
      build: () => Promise.resolve(current),
      snapshot: () => Promise.resolve(current),
    });
    await store.getState().load(ROOT);
    await store.getState().inspectBlast("src/b.ts");
    current = makeSnapshot(["src/a.ts"]);
    await store.getState().refresh();
    expect(store.getState().blast).toBeNull();
  });
});

describe("blast highlight state", () => {
  const blast = {
    origin: "src/leaf.ts",
    depths: new Map([
      ["src/mid.ts", 1],
      ["src/top.ts", 2],
    ]),
  };

  test("is inactive without a selection", () => {
    expect(blastRole(null, "src/mid.ts")).toEqual({ kind: "inactive" });
  });

  test("marks the origin, its dependents by depth, and everything else as outside", () => {
    expect(blastRole(blast, "src/leaf.ts")).toEqual({ kind: "origin" });
    expect(blastRole(blast, "src/mid.ts")).toEqual({ kind: "dependent", depth: 1 });
    expect(blastRole(blast, "src/top.ts")).toEqual({ kind: "dependent", depth: 2 });
    expect(blastRole(blast, "src/unrelated.ts")).toEqual({ kind: "outside" });
  });

  test("does not dim the graph while the radius is still loading", () => {
    const loading = { origin: "src/leaf.ts", depths: null };
    expect(blastRole(loading, "src/leaf.ts")).toEqual({ kind: "origin" });
    expect(blastRole(loading, "src/mid.ts")).toEqual({ kind: "inactive" });
  });
});

describe("positions and failures", () => {
  test("keeps saved layout across reindexing the same root and clears it for a new root", async () => {
    await h.store.getState().load(ROOT);
    h.store.getState().savePositions(new Map([["src/a.ts", { x: 1, y: 2 }]]));
    await h.store.getState().reindex();
    expect(h.store.getState().positions.get("src/a.ts")).toEqual({ x: 1, y: 2 });
    await h.store.getState().load("C:/other");
    expect(h.store.getState().positions.size).toBe(0);
  });

  test("reportFailure surfaces renderer errors in the store", () => {
    h.store.getState().reportFailure(new Error("WebGL is not available"));
    expect(h.store.getState().status).toBe("error");
    expect(h.store.getState().error).toBe("WebGL is not available");
  });
});
