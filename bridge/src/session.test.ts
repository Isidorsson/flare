import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AppMessageOf, BridgeEvent } from "@flare/protocol";

import { AgentSession } from "./session";
import { rejectionOf } from "./testing/async-helpers";
import { createFakeFs } from "./testing/fake-fs";
import { FakeQuery } from "./testing/fake-query";
import { assistantMessage, resultMessage, textBlock, toolResultMessage, toolUseBlock } from "./testing/sdk-messages";

const CWD = resolve("/work/app");
const FILE = resolve(CWD, "a.ts");

const START: AppMessageOf<"session.start"> = {
  type: "session.start",
  cwd: CWD,
  model: "sonnet",
  effort: "high",
  permissionMode: "default",
};

function setup(files: Record<string, string> = {}) {
  const events: BridgeEvent[] = [];
  const queries: FakeQuery[] = [];
  const logs: string[] = [];
  const fs = createFakeFs(files);
  const session = new AgentSession({
    createQuery: (params) => {
      const query = new FakeQuery(params);
      queries.push(query);
      return query;
    },
    emit: (event) => events.push(event),
    readText: fs.readText,
    resolveClaudeExecutable: () => "C:/bin/claude.exe",
    createSessionId: () => "new-session-id",
    log: (line) => logs.push(line),
  });

  function live(): FakeQuery {
    const query = queries.at(-1);
    if (!query) throw new Error("no query was created");
    return query;
  }
  async function deliver(...messages: SDKMessage[]): Promise<void> {
    for (const message of messages) live().push(message);
    live().end();
    await session.settled();
  }
  return { session, events, queries, logs, fs, live, deliver };
}

describe("AgentSession.start", () => {
  test("creates a streaming query for a new session with a generated id", () => {
    const { session, events, live } = setup();
    session.start(START);

    const { options } = live().params;
    expect(options).toMatchObject({
      cwd: CWD,
      model: "sonnet",
      effort: "high",
      permissionMode: "default",
      includePartialMessages: true,
      pathToClaudeCodeExecutable: "C:/bin/claude.exe",
      sessionId: "new-session-id",
    });
    expect(options.resume).toBeUndefined();
    expect(events).toEqual([{ type: "session.ready", sessionId: "new-session-id" }]);
  });

  test("resumes an existing session by id", () => {
    const { session, events, live } = setup();
    session.start({ ...START, resume: "old-session" });

    expect(live().params.options.resume).toBe("old-session");
    expect(live().params.options.sessionId).toBeUndefined();
    expect(events).toEqual([{ type: "session.ready", sessionId: "old-session" }]);
  });

  test("closes the previous query when a new session starts", () => {
    const { session, queries } = setup();
    session.start(START);
    session.start(START);

    expect(queries).toHaveLength(2);
    expect(queries[0]?.calls).toContain("close");
    expect(queries[1]?.calls).not.toContain("close");
  });

  test("propagates a failure to locate claude without leaving a half started session", () => {
    const events: BridgeEvent[] = [];
    const session = new AgentSession({
      createQuery: () => {
        throw new Error("unreachable");
      },
      emit: (event) => events.push(event),
      readText: createFakeFs().readText,
      resolveClaudeExecutable: () => {
        throw new Error("claude not found");
      },
      createSessionId: () => "id",
      log: () => undefined,
    });

    expect(() => {
      session.start(START);
    }).toThrow("claude not found");
    expect(() => {
      session.sendUserMessage("hi");
    }).toThrow("No active session");
  });

  test("forwards the CLI stderr to the log", () => {
    const { session, live, logs } = setup();
    session.start(START);
    live().params.options.stderr?.("warning from claude");
    expect(logs).toEqual(["warning from claude"]);
  });
});

describe("AgentSession message flow", () => {
  test("feeds user messages to the long lived query input", async () => {
    const { session, live } = setup();
    session.start(START);
    session.sendUserMessage("first");
    session.sendUserMessage("second");

    const iterator = live().params.prompt[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "user", message: { role: "user", content: "first" } });
    expect((await iterator.next()).value).toMatchObject({ message: { content: "second" } });
  });

  test("normalises and emits SDK messages in order", async () => {
    const { session, events, deliver } = setup();
    session.start(START);
    const reply = assistantMessage([textBlock("Hi there")]);

    await deliver(reply, resultMessage());

    expect(events.map((event) => event.type)).toEqual([
      "session.ready",
      "assistant.message",
      "turn.completed",
      "error",
    ]);
    expect(events[1]).toEqual({ type: "assistant.message", id: reply.uuid, text: "Hi there" });
  });

  test("reports the end of the CLI process as a fatal error and forgets the session", async () => {
    const { session, events, deliver } = setup();
    session.start(START);

    await deliver();

    expect(events.at(-1)).toEqual({ type: "error", message: "Claude Code ended the session.", fatal: true });
    expect(() => {
      session.sendUserMessage("anyone there?");
    }).toThrow("No active session");
  });

  test("reports a crashing CLI as a fatal error with the reason", async () => {
    const { session, events, live } = setup();
    session.start(START);

    live().fail(new Error("spawn EACCES"));
    await session.settled();

    expect(events.at(-1)).toEqual({ type: "error", message: "Claude Code stopped: spawn EACCES", fatal: true });
  });

  test("stays quiet when the session was closed on purpose", async () => {
    const { session, events, live } = setup();
    session.start(START);
    const pump = session.settled();

    session.close();
    live().end();
    await pump;

    expect(events).toEqual([{ type: "session.ready", sessionId: "new-session-id" }]);
  });

  test("drops events of a replaced session", async () => {
    const { session, events, queries } = setup();
    session.start(START);
    const stale = queries[0];
    session.start({ ...START, resume: "other" });

    stale?.push(assistantMessage([textBlock("late")]));
    stale?.end();
    await Promise.resolve();

    expect(events.filter((event) => event.type === "assistant.message")).toEqual([]);
  });
});

describe("AgentSession permissions", () => {
  test("asks the app and resolves canUseTool with the decision", async () => {
    const { session, events, live } = setup();
    session.start(START);
    const { canUseTool } = live().params.options;
    if (!canUseTool) throw new Error("canUseTool was not configured");

    const decision = canUseTool("Bash", { command: "ls" }, { signal: new AbortController().signal, toolUseID: "t1", requestId: "req-1" });
    expect(events.at(-1)).toEqual({ type: "permission.request", requestId: "req-1", toolName: "Bash", input: { command: "ls" } });

    session.respondToPermission("req-1", "allow");
    expect(await decision).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
  });

  test("rejects an answer for a request that does not exist", () => {
    const { session } = setup();
    session.start(START);
    expect(() => {
      session.respondToPermission("ghost", "allow");
    }).toThrow("ghost");
  });

  test("interrupt denies pending requests and interrupts the query", async () => {
    const { session, live } = setup();
    session.start(START);
    const { canUseTool } = live().params.options;
    if (!canUseTool) throw new Error("canUseTool was not configured");
    const decision = canUseTool("Bash", {}, { signal: new AbortController().signal, toolUseID: "t1", requestId: "req-1" });

    await session.interrupt();

    expect(await decision).toMatchObject({ behavior: "deny" });
    expect(live().calls).toContain("interrupt");
  });

  test("closing the session denies pending requests", async () => {
    const { session, live } = setup();
    session.start(START);
    const { canUseTool } = live().params.options;
    if (!canUseTool) throw new Error("canUseTool was not configured");
    const decision = canUseTool("Bash", {}, { signal: new AbortController().signal, toolUseID: "t1", requestId: "req-1" });

    session.close();

    expect(await decision).toEqual({ behavior: "deny", message: "The session was closed." });
  });
});

describe("AgentSession controls", () => {
  test("changes the model, effort and permission mode of the live query", async () => {
    const { session, live } = setup();
    session.start(START);

    await session.setModel("opus");
    await session.setEffort("max");
    await session.setPermissionMode("acceptEdits");

    expect(live().calls).toEqual(["setModel:opus", "effort:max", "setPermissionMode:acceptEdits"]);
  });

  test("rejects controls before a session has started", async () => {
    const { session } = setup();
    expect((await rejectionOf(session.interrupt())).message).toContain("No active session");
    expect((await rejectionOf(session.setModel("opus"))).message).toContain("No active session");
  });
});

describe("AgentSession file capture hook", () => {
  test("captures the file before the tool runs through the PreToolUse hook", async () => {
    const { session, events, fs, live } = setup({ [FILE]: "before" });
    session.start(START);
    const hook = live().params.options.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!hook) throw new Error("PreToolUse hook was not configured");
    const input = { file_path: FILE, old_string: "before", new_string: "after" };

    await hook(
      {
        hook_event_name: "PreToolUse",
        session_id: "s",
        transcript_path: "t",
        cwd: CWD,
        tool_name: "Edit",
        tool_input: input,
        tool_use_id: "t1",
      },
      "t1",
      { signal: new AbortController().signal },
    );
    fs.write(FILE, "after");
    live().push(assistantMessage([toolUseBlock("t1", "Edit", input)]));
    live().push(toolResultMessage([{ id: "t1", content: "ok" }]));
    live().end();
    await session.settled();

    expect(events.find((event) => event.type === "file.change")).toEqual({
      type: "file.change",
      toolUseId: "t1",
      path: FILE,
      kind: "update",
      before: "before",
      after: "after",
    });
  });

  test("lets the tool continue even for events it does not care about", async () => {
    const { session, live } = setup();
    session.start(START);
    const hook = live().params.options.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!hook) throw new Error("PreToolUse hook was not configured");

    const output = await hook(
      { hook_event_name: "Notification", session_id: "s", transcript_path: "t", cwd: CWD, message: "m", notification_type: "x" },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(output).toEqual({ continue: true });
  });
});
