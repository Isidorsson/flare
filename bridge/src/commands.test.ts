import { describe, expect, test } from "bun:test";

import { encodeLine, type AppMessage, type BridgeEvent } from "@flare/protocol";

import { processLine, runCommandLoop } from "./commands";
import { AgentSession } from "./session";
import { chunksOf } from "./testing/async-helpers";
import { createFakeFs } from "./testing/fake-fs";
import { FakeQuery } from "./testing/fake-query";

function setup() {
  const events: BridgeEvent[] = [];
  const queries: FakeQuery[] = [];
  const session = new AgentSession({
    createQuery: (params) => {
      const query = new FakeQuery(params);
      queries.push(query);
      return query;
    },
    emit: (event) => events.push(event),
    readText: createFakeFs().readText,
    resolveClaudeExecutable: () => "claude.exe",
    createSessionId: () => "sid",
    log: () => undefined,
  });
  const emit = (event: BridgeEvent) => events.push(event);
  return { session, events, queries, emit };
}

const start: AppMessage = {
  type: "session.start",
  cwd: "/work",
  model: "sonnet",
  effort: "low",
  permissionMode: "plan",
};

describe("processLine", () => {
  test("dispatches each command type to the session", async () => {
    const { session, events, queries, emit } = setup();

    await processLine(encodeLine(start).trim(), session, emit);
    await processLine(encodeLine({ type: "user.message", text: "hi" }).trim(), session, emit);
    await processLine(encodeLine({ type: "session.setModel", model: "opus" }).trim(), session, emit);
    await processLine(encodeLine({ type: "session.setEffort", effort: "max" }).trim(), session, emit);
    await processLine(encodeLine({ type: "session.setPermissionMode", permissionMode: "default" }).trim(), session, emit);
    await processLine(encodeLine({ type: "interrupt" }).trim(), session, emit);

    expect(events).toEqual([{ type: "session.ready", sessionId: "sid" }]);
    expect(queries[0]?.calls).toEqual(["setModel:opus", "effort:max", "setPermissionMode:default", "interrupt"]);
  });

  test("relays the auto permission mode from the wire to the SDK", async () => {
    const { session, queries, emit } = setup();

    await processLine(encodeLine({ ...start, permissionMode: "auto" }).trim(), session, emit);
    await processLine(encodeLine({ type: "session.setPermissionMode", permissionMode: "auto" }).trim(), session, emit);

    expect(queries[0]?.params.options.permissionMode).toBe("auto");
    expect(queries[0]?.calls).toEqual(["setPermissionMode:auto"]);
  });

  test("reports a malformed line as a non fatal error and keeps going", async () => {
    const { session, events, emit } = setup();

    await processLine("{not json", session, emit);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
    expect(events[0]).not.toHaveProperty("fatal", true);
  });

  test("reports a command that needs a session as a non fatal error", async () => {
    const { session, events, emit } = setup();

    await processLine('{"type":"user.message","text":"hi"}', session, emit);

    expect(events).toEqual([{ type: "error", message: "No active session; send session.start first", fatal: false }]);
  });

  test("marks a failed session.start as fatal", async () => {
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
      createSessionId: () => "sid",
      log: () => undefined,
    });

    await processLine(encodeLine(start).trim(), session, (event) => events.push(event));

    expect(events).toEqual([{ type: "error", message: "claude not found", fatal: true }]);
  });
});

describe("runCommandLoop", () => {
  test("reassembles lines split across chunks and multi byte characters split mid sequence", async () => {
    const { session, queries, emit } = setup();
    const startLine = encodeLine(start);
    const messageLine = encodeLine({ type: "user.message", text: "héllo wörld" });
    const bytes = new TextEncoder().encode(startLine + messageLine);
    const cut = startLine.length + messageLine.indexOf("é") + 1;

    await runCommandLoop(chunksOf(bytes.slice(0, 10), bytes.slice(10, cut), bytes.slice(cut)), session, emit);

    const iterator = queries[0]?.params.prompt[Symbol.asyncIterator]();
    expect((await iterator?.next())?.value).toMatchObject({ message: { content: "héllo wörld" } });
  });

  test("processes a final line without a trailing newline when stdin closes", async () => {
    const { session, events, emit } = setup();
    await runCommandLoop(chunksOf(new TextEncoder().encode(JSON.stringify(start))), session, emit);

    expect(events).toEqual([{ type: "session.ready", sessionId: "sid" }]);
  });

  test("handles commands strictly in order", async () => {
    const { session, events, emit } = setup();
    const input = new TextEncoder().encode(
      `${encodeLine({ type: "user.message", text: "too early" })}${encodeLine(start)}${encodeLine({ type: "user.message", text: "ok" })}`,
    );

    await runCommandLoop(chunksOf(input), session, emit);

    expect(events.map((event) => event.type)).toEqual(["error", "session.ready"]);
  });
});
