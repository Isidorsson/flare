import { describe, expect, spyOn, test } from "bun:test";

import { encodeLine, parseAppMessage, type AppMessage, type BridgeEvent } from "@flare/protocol";

import { selectActiveThread, selectIsBusy, selectLiveThread } from "./agent-selectors";
import { AGENT_SETTINGS_STORAGE_KEY, createAgentStore } from "./agent-store";
import type { BridgeTransport } from "./bridge-transport";
import { DEFAULT_SESSION_SETTINGS } from "./session-settings";
import { rejectionOf } from "./testing/rejection-of";

const usage = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, value: string) => {
      data.set(name, value);
    },
    removeItem: (name: string) => {
      data.delete(name);
    },
  };
}

function setup(options: { root?: string | null; storage?: ReturnType<typeof memoryStorage> } = {}) {
  const root = options.root === undefined ? "C:/work" : options.root;
  const sent: AppMessage[] = [];
  const published: BridgeEvent[] = [];
  const listeners: ((line: string) => void)[] = [];
  const failures: { start: Error | null; send: Error | null } = { start: null, send: null };
  let ids = 0;

  const transport: BridgeTransport = {
    start: (onLine) => {
      if (failures.start) return Promise.reject(failures.start);
      listeners.push(onLine);
      return Promise.resolve();
    },
    send: (line) => {
      if (failures.send) return Promise.reject(failures.send);
      sent.push(parseAppMessage(line.trim()));
      return Promise.resolve();
    },
  };
  const store = createAgentStore({
    transport,
    getWorkspaceRoot: () => root,
    publish: (event) => published.push(event),
    now: () => 1000,
    createId: () => `thread-${(ids += 1)}`,
    storage: options.storage ?? memoryStorage(),
  });

  return {
    store,
    sent,
    published,
    failures,
    starts: () => listeners.length,
    emit: (event: BridgeEvent, listener = listeners.length - 1) => {
      listeners[listener]?.(encodeLine(event).trim());
    },
    emitRaw: (line: string) => {
      listeners.at(-1)?.(line);
    },
    state: () => store.getState(),
    settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  };
}

async function startThread(ctx: ReturnType<typeof setup>, text = "hello") {
  ctx.state().sendMessage(text);
  await ctx.settle();
  ctx.emit({ type: "session.ready", sessionId: "session-1" });
}

describe("starting a conversation", () => {
  test("creates a thread in the workspace root and starts a session before sending the message", async () => {
    const ctx = setup();
    ctx.state().sendMessage("  Explain this repo ");
    await ctx.settle();

    const thread = selectActiveThread(ctx.state());
    expect(thread).toMatchObject({ cwd: "C:/work", title: "Explain this repo", status: "running" });
    expect(thread?.items[0]).toMatchObject({ kind: "user", text: "Explain this repo" });
    expect(ctx.state().liveThreadId).toBe(thread?.id ?? null);
    expect(ctx.sent).toEqual([
      { type: "session.start", cwd: "C:/work", ...DEFAULT_SESSION_SETTINGS },
      { type: "user.message", text: "Explain this repo" },
    ]);
  });

  test("ignores blank messages", async () => {
    const ctx = setup();
    ctx.state().sendMessage("   ");
    await ctx.settle();
    expect(ctx.state().threads).toEqual([]);
    expect(ctx.sent).toEqual([]);
  });

  test("refuses to start without an open folder", () => {
    const ctx = setup({ root: null });
    expect(() => {
      ctx.state().sendMessage("hi");
    }).toThrow("Open a folder");
  });

  test("keeps using the live session for follow up messages", async () => {
    const ctx = setup();
    await startThread(ctx);
    ctx.emit({ type: "turn.completed", costUsd: 0.1, usage });

    ctx.state().sendMessage("and then?");
    await ctx.settle();

    expect(ctx.sent.map((message) => message.type)).toEqual(["session.start", "user.message", "user.message"]);
    expect(ctx.starts()).toBe(1);
    expect(selectActiveThread(ctx.state())?.items.filter((item) => item.kind === "user")).toHaveLength(2);
  });
});

describe("receiving events", () => {
  test("routes events to the live thread and publishes them to subscribers", async () => {
    const ctx = setup();
    await startThread(ctx);

    ctx.emit({ type: "assistant.delta", text: "Hi" });
    ctx.emit({ type: "turn.completed", costUsd: 0.25, usage });

    const thread = selectLiveThread(ctx.state());
    expect(thread).toMatchObject({ sessionId: "session-1", status: "idle", costUsd: 0.25 });
    expect(thread?.items.at(-1)).toMatchObject({ kind: "assistant", text: "Hi" });
    expect(ctx.published.map((event) => event.type)).toEqual(["session.ready", "assistant.delta", "turn.completed"]);
    expect(selectIsBusy(ctx.state())).toBe(false);
  });

  test("shows an invalid bridge message as a notice and does not publish it", async () => {
    const ctx = setup();
    await startThread(ctx);

    ctx.emitRaw('{"type":"assistant.delta"}');

    expect(selectLiveThread(ctx.state())?.items.at(-1)).toMatchObject({ kind: "notice" });
    expect(ctx.published.map((event) => event.type)).toEqual(["session.ready"]);
  });

  test("ignores lines from a bridge process that was replaced", async () => {
    const ctx = setup();
    await startThread(ctx);
    ctx.emit({ type: "error", message: "bridge exited", fatal: true });
    ctx.state().sendMessage("again");
    await ctx.settle();
    expect(ctx.starts()).toBe(2);

    ctx.emit({ type: "error", message: "old process exited", fatal: true }, 0);

    expect(ctx.state().liveThreadId).not.toBeNull();
    expect(selectLiveThread(ctx.state())?.items.some((item) => item.kind === "notice" && item.text === "old process exited")).toBe(false);
  });

  test("a fatal error ends the live session and the next message resumes it", async () => {
    const ctx = setup();
    await startThread(ctx);
    ctx.emit({ type: "error", message: "claude crashed", fatal: true });

    expect(ctx.state().liveThreadId).toBeNull();
    expect(selectActiveThread(ctx.state())).toMatchObject({ status: "idle" });

    ctx.state().sendMessage("try again");
    await ctx.settle();

    expect(ctx.starts()).toBe(2);
    expect(ctx.sent.at(-2)).toMatchObject({ type: "session.start", resume: "session-1" });
    expect(ctx.sent.at(-1)).toEqual({ type: "user.message", text: "try again" });
  });

  test("shows an error that arrives without a live session on the active thread", async () => {
    const ctx = setup();
    await startThread(ctx);
    ctx.emit({ type: "error", message: "gone", fatal: true });
    ctx.emit({ type: "error", message: "No active session" });

    expect(selectActiveThread(ctx.state())?.items.at(-1)).toMatchObject({ kind: "notice", text: "No active session" });
  });
});

describe("failures talking to the bridge", () => {
  test("shows a failure to start the bridge and stops the thread", async () => {
    const ctx = setup();
    ctx.failures.start = new Error("sidecar missing");

    ctx.state().sendMessage("hi");
    await ctx.settle();

    const thread = selectActiveThread(ctx.state());
    expect(thread?.status).toBe("idle");
    expect(thread?.items.at(-1)).toMatchObject({ kind: "notice", text: "sidecar missing" });
    expect(ctx.state().liveThreadId).toBeNull();
  });

  test("retries starting the bridge on the next message after a send failure", async () => {
    const ctx = setup();
    await startThread(ctx);
    ctx.emit({ type: "turn.completed", costUsd: 0, usage });
    ctx.failures.send = new Error("the agent bridge is not running");

    ctx.state().sendMessage("one");
    await ctx.settle();
    ctx.failures.send = null;
    ctx.state().sendMessage("two");
    await ctx.settle();

    expect(ctx.starts()).toBe(2);
    expect(ctx.sent.at(-1)).toEqual({ type: "user.message", text: "two" });
  });
});

describe("standalone requests", () => {
  const commitRequest: AppMessage = {
    type: "commit.generate",
    requestId: "c1",
    stat: " a.ts | 1 +",
    patch: "diff --git a/a.ts b/a.ts\n+a\n",
    truncated: false,
    recentSubjects: [],
    includeBody: false,
  };

  test("starts the bridge if it is not running and sends without creating a thread or session", async () => {
    const ctx = setup();

    await ctx.state().sendStandalone(commitRequest);

    expect(ctx.starts()).toBe(1);
    expect(ctx.sent).toEqual([commitRequest]);
    expect(ctx.state().threads).toEqual([]);
    expect(ctx.state().liveThreadId).toBeNull();
  });

  test("reuses a bridge that is already running, whether a chat or a commit started it", async () => {
    const ctx = setup();

    await ctx.state().sendStandalone(commitRequest);
    await ctx.state().sendStandalone({ ...commitRequest, requestId: "c2" });
    await startThread(ctx);

    expect(ctx.starts()).toBe(1);
    expect(ctx.sent.map((message) => message.type)).toEqual([
      "commit.generate",
      "commit.generate",
      "session.start",
      "user.message",
    ]);
  });

  test("sends while a thread is running without disturbing it", async () => {
    const ctx = setup();
    await startThread(ctx);

    await ctx.state().sendStandalone(commitRequest);

    expect(selectLiveThread(ctx.state())?.status).toBe("running");
    expect(ctx.sent.map((message) => message.type)).toEqual(["session.start", "user.message", "commit.generate"]);
  });

  test("rejects when the bridge cannot start, and retries on the next call", async () => {
    const ctx = setup();
    ctx.failures.start = new Error("sidecar missing");

    expect((await rejectionOf(ctx.state().sendStandalone(commitRequest))).message).toBe("sidecar missing");
    ctx.failures.start = null;
    await ctx.state().sendStandalone(commitRequest);

    expect(ctx.sent).toEqual([commitRequest]);
  });

  test("rejects when the send fails and starts the bridge again next time", async () => {
    const ctx = setup();
    await ctx.state().sendStandalone(commitRequest);
    ctx.failures.send = new Error("the agent bridge is not running");

    expect((await rejectionOf(ctx.state().sendStandalone(commitRequest))).message).toBe("the agent bridge is not running");
    ctx.failures.send = null;
    await ctx.state().sendStandalone(commitRequest);

    expect(ctx.starts()).toBe(2);
  });

  test("publishes commit replies to subscribers without adding them to the live thread", async () => {
    const ctx = setup();
    await startThread(ctx);
    const before = selectLiveThread(ctx.state());

    ctx.emit({ type: "commit.generated", requestId: "c1", subject: "fix: x", body: null });
    ctx.emit({ type: "commit.failed", requestId: "c2", message: "nope" });

    expect(ctx.published.map((event) => event.type)).toEqual(["session.ready", "commit.generated", "commit.failed"]);
    expect(selectLiveThread(ctx.state())).toEqual(before);
  });

  test("keeps commit replies out of an idle conversation, even with no live session", async () => {
    const ctx = setup();
    await ctx.state().sendStandalone(commitRequest);

    ctx.emit({ type: "commit.failed", requestId: "c1", message: "nope" });

    expect(ctx.state().threads).toEqual([]);
    expect(ctx.published).toEqual([{ type: "commit.failed", requestId: "c1", message: "nope" }]);
  });
});

describe("permissions and interrupt", () => {
  test("records the decision and sends it to the bridge", async () => {
    const ctx = setup();
    await startThread(ctx);
    ctx.emit({ type: "permission.request", requestId: "r1", toolName: "Bash", input: { command: "ls" } });

    ctx.state().respondToPermission("r1", "allowSession");
    await ctx.settle();

    expect(selectLiveThread(ctx.state())?.items.at(-1)).toMatchObject({ kind: "permission", status: "allowSession" });
    expect(ctx.sent.at(-1)).toEqual({ type: "permission.respond", requestId: "r1", decision: "allowSession" });
  });

  test("sends an interrupt for the live session", async () => {
    const ctx = setup();
    await startThread(ctx);

    ctx.state().interrupt();
    await ctx.settle();

    expect(ctx.sent.at(-1)).toEqual({ type: "interrupt" });
  });

  test("does nothing without a live session", async () => {
    const ctx = setup();
    ctx.state().interrupt();
    ctx.state().respondToPermission("r1", "allow");
    await ctx.settle();
    expect(ctx.sent).toEqual([]);
  });
});

describe("threads", () => {
  async function twoThreads() {
    const ctx = setup();
    await startThread(ctx, "first");
    ctx.emit({ type: "turn.completed", costUsd: 0, usage });
    ctx.state().newThread();
    ctx.state().sendMessage("second");
    await ctx.settle();
    ctx.emit({ type: "session.ready", sessionId: "session-2" });
    ctx.emit({ type: "turn.completed", costUsd: 0, usage });
    return ctx;
  }

  test("a new thread starts a fresh session without resume", async () => {
    const ctx = await twoThreads();
    const starts = ctx.sent.filter((message) => message.type === "session.start");

    expect(starts).toHaveLength(2);
    expect(starts[1]).not.toHaveProperty("resume");
    expect(ctx.state().threads.map((thread) => thread.title)).toEqual(["second", "first"]);
  });

  test("selecting an idle thread resumes its session", async () => {
    const ctx = await twoThreads();
    const first = ctx.state().threads[1];

    ctx.state().selectThread(first?.id ?? "");
    await ctx.settle();

    expect(ctx.state().activeThreadId).toBe(first?.id ?? null);
    expect(ctx.state().liveThreadId).toBe(first?.id ?? null);
    expect(ctx.sent.at(-1)).toMatchObject({ type: "session.start", resume: "session-1" });
  });

  test("selecting the live thread does not restart its session", async () => {
    const ctx = await twoThreads();
    const live = selectLiveThread(ctx.state());
    const before = ctx.sent.length;

    ctx.state().selectThread(live?.id ?? "");
    await ctx.settle();

    expect(ctx.sent).toHaveLength(before);
  });

  test("does not take the session away from a thread that is running", async () => {
    const ctx = await twoThreads();
    ctx.state().sendMessage("keep going");
    await ctx.settle();
    const other = ctx.state().threads[1];
    const before = ctx.sent.length;

    ctx.state().selectThread(other?.id ?? "");
    await ctx.settle();
    expect(ctx.state().activeThreadId).toBe(other?.id ?? null);
    expect(ctx.sent).toHaveLength(before);

    ctx.state().sendMessage("hijack");
    await ctx.settle();
    expect(ctx.sent).toHaveLength(before);
    expect(selectActiveThread(ctx.state())?.items.at(-1)).toMatchObject({ kind: "notice" });
    expect(selectIsBusy(ctx.state())).toBe(true);
  });
});

describe("settings", () => {
  test("applies only the changed settings to a live session", async () => {
    const ctx = setup();
    await startThread(ctx);

    ctx.state().changeSettings({ model: "haiku", effort: DEFAULT_SESSION_SETTINGS.effort });
    ctx.state().changeSettings({ effort: "max", permissionMode: "acceptEdits" });
    await ctx.settle();

    expect(ctx.sent.slice(2)).toEqual([
      { type: "session.setModel", model: "haiku" },
      { type: "session.setEffort", effort: "max" },
      { type: "session.setPermissionMode", permissionMode: "acceptEdits" },
    ]);
  });

  test("keeps a response style change for the next session instead of sending it live", async () => {
    const ctx = setup();
    await startThread(ctx);

    ctx.state().changeSettings({ outputStyle: "Explanatory" });
    await ctx.settle();

    expect(ctx.sent).toHaveLength(2);
    expect(ctx.state().settings.outputStyle).toBe("Explanatory");
  });

  test("only stores settings when nothing is live and uses them for the next session", async () => {
    const ctx = setup();
    ctx.state().changeSettings({ model: "haiku", effort: "low" });
    ctx.state().sendMessage("hi");
    await ctx.settle();

    expect(ctx.sent[0]).toMatchObject({ type: "session.start", model: "haiku", effort: "low" });
  });

  test("persists settings but not threads, and restores them", () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    first.state().changeSettings({ model: "opus" });

    const persisted = storage.data.get(AGENT_SETTINGS_STORAGE_KEY) ?? "";
    expect(JSON.parse(persisted)).toMatchObject({ state: { settings: { model: "opus" } } });
    expect(persisted).not.toContain("threads");

    const second = setup({ storage });
    expect(second.state().settings.model).toBe("opus");
  });

  test("discards invalid persisted settings", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const storage = memoryStorage({
      [AGENT_SETTINGS_STORAGE_KEY]: JSON.stringify({ state: { settings: { model: "gpt", effort: "high", permissionMode: "default" } }, version: 0 }),
    });

    const ctx = setup({ storage });

    expect(ctx.state().settings).toEqual(DEFAULT_SESSION_SETTINGS);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
