import { describe, expect, test } from "bun:test";

import { encodeLine, type AppMessage, type BridgeEvent } from "@flare/protocol";

import { processLine, runCommandLoop, type CommandHandlers } from "./commands";
import { AgentSession } from "./session";
import { chunksOf } from "./testing/async-helpers";
import { commitRequest, createCommitHarness } from "./testing/commit-harness";
import { createFakeFs } from "./testing/fake-fs";
import { FAKE_OUTPUT_STYLES, FakeQuery } from "./testing/fake-query";
import { createPullRequestHarness, pullRequestRequest } from "./testing/pr-harness";
import { assistantMessage, resultMessage, textBlock } from "./testing/sdk-messages";

function setup() {
  const commit = createCommitHarness();
  const pr = createPullRequestHarness();
  const events = commit.events;
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
  const handlers: CommandHandlers = { session, commitMessages: commit.generator, pullRequests: pr.generator };
  const emit = (event: BridgeEvent) => events.push(event);
  return { handlers, session, events, queries, commit, pr, emit };
}

const start: AppMessage = {
  type: "session.start",
  cwd: "/work",
  model: "sonnet",
  effort: "low",
  permissionMode: "plan",
  outputStyle: "Concise",
};

describe("processLine", () => {
  test("dispatches each command type to the session", async () => {
    const { handlers, events, queries, emit } = setup();

    await processLine(encodeLine(start).trim(), handlers, emit);
    await processLine(encodeLine({ type: "user.message", text: "hi" }).trim(), handlers, emit);
    await processLine(encodeLine({ type: "session.setModel", model: "opus" }).trim(), handlers, emit);
    await processLine(encodeLine({ type: "session.setEffort", effort: "max" }).trim(), handlers, emit);
    await processLine(encodeLine({ type: "session.setPermissionMode", permissionMode: "default" }).trim(), handlers, emit);
    await processLine(encodeLine({ type: "interrupt" }).trim(), handlers, emit);

    expect(events).toEqual([
      { type: "session.ready", sessionId: "sid" },
      { type: "session.outputStyles", available: FAKE_OUTPUT_STYLES },
    ]);
    expect(queries[0]?.calls).toEqual(["setModel:opus", "effort:max", "setPermissionMode:default", "interrupt"]);
  });

  test("relays the auto permission mode from the wire to the SDK", async () => {
    const { handlers, queries, emit } = setup();

    await processLine(encodeLine({ ...start, permissionMode: "auto" }).trim(), handlers, emit);
    await processLine(encodeLine({ type: "session.setPermissionMode", permissionMode: "auto" }).trim(), handlers, emit);

    expect(queries[0]?.params.options.permissionMode).toBe("auto");
    expect(queries[0]?.calls).toEqual(["setPermissionMode:auto"]);
  });

  test("reports a malformed line as a non fatal error and keeps going", async () => {
    const { handlers, events, emit } = setup();

    await processLine("{not json", handlers, emit);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
    expect(events[0]).not.toHaveProperty("fatal", true);
  });

  test("reports a command that needs a session as a non fatal error", async () => {
    const { handlers, events, emit } = setup();

    await processLine('{"type":"user.message","text":"hi"}', handlers, emit);

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
    const handlers: CommandHandlers = {
      session,
      commitMessages: createCommitHarness().generator,
      pullRequests: createPullRequestHarness().generator,
    };

    await processLine(encodeLine(start).trim(), handlers, (event) => events.push(event));

    expect(events).toEqual([{ type: "error", message: "claude not found", fatal: true }]);
  });
});

describe("commit.generate", () => {
  test("is answered without a started session and leaves the chat session alone", async () => {
    const { handlers, commit, events, queries, emit } = setup();

    await processLine(encodeLine(commitRequest()).trim(), handlers, emit);
    commit.queries[0]?.push(assistantMessage([textBlock('{"subject":"fix(a): bump a","body":null}')]));
    commit.queries[0]?.push(resultMessage({ result: '{"subject":"fix(a): bump a","body":null}' }));
    await commit.generator.settled();

    expect(events).toEqual([{ type: "commit.generated", requestId: "c1", subject: "fix(a): bump a", body: null }]);
    expect(queries).toHaveLength(0);
  });

  test("does not hold up the commands queued behind it", async () => {
    const { handlers, commit, events, emit } = setup();
    const input = new TextEncoder().encode(`${encodeLine(commitRequest())}${encodeLine(start)}`);

    await runCommandLoop(chunksOf(input), handlers, emit);

    expect(events.map((event) => event.type)).toEqual(["session.ready", "session.outputStyles"]);
    expect(commit.queries).toHaveLength(1);

    commit.queries[0]?.end();
    await commit.generator.settled();
  });

  test("reports a request that is already running as a non fatal error", async () => {
    const { handlers, commit, events, emit } = setup();

    await processLine(encodeLine(commitRequest()).trim(), handlers, emit);
    await processLine(encodeLine(commitRequest()).trim(), handlers, emit);

    expect(events).toEqual([{ type: "error", message: "Request c1 for a commit message is already running", fatal: false }]);

    commit.queries[0]?.end();
    await commit.generator.settled();
  });
});

describe("pr.generate", () => {
  const prReply = '{"title":"feat(auth): add login","body":"## Summary\\n- Add login."}';

  test("is answered by the pull request generator without a started session", async () => {
    const { handlers, pr, events, queries, emit } = setup();

    await processLine(encodeLine(pullRequestRequest()).trim(), handlers, emit);
    pr.queries[0]?.push(assistantMessage([textBlock(prReply)]));
    pr.queries[0]?.push(resultMessage({ result: prReply }));
    await pr.generator.settled();

    expect(pr.events).toEqual([
      { type: "pr.generated", requestId: "p1", title: "feat(auth): add login", body: "## Summary\n- Add login." },
    ]);
    expect(events).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  test("does not start a commit message query", async () => {
    const { handlers, commit, pr, emit } = setup();

    await processLine(encodeLine(pullRequestRequest()).trim(), handlers, emit);

    expect(commit.queries).toHaveLength(0);
    expect(pr.queries).toHaveLength(1);
    pr.queries[0]?.end();
    await pr.generator.settled();
  });

  test("reports a request that is already running as a non fatal error", async () => {
    const { handlers, pr, events, emit } = setup();

    await processLine(encodeLine(pullRequestRequest()).trim(), handlers, emit);
    await processLine(encodeLine(pullRequestRequest()).trim(), handlers, emit);

    expect(events).toEqual([
      { type: "error", message: "Request p1 for a pull request description is already running", fatal: false },
    ]);

    pr.queries[0]?.end();
    await pr.generator.settled();
  });
});

describe("runCommandLoop", () => {
  test("reassembles lines split across chunks and multi byte characters split mid sequence", async () => {
    const { handlers, queries, emit } = setup();
    const startLine = encodeLine(start);
    const messageLine = encodeLine({ type: "user.message", text: "héllo wörld" });
    const bytes = new TextEncoder().encode(startLine + messageLine);
    const cut = startLine.length + messageLine.indexOf("é") + 1;

    await runCommandLoop(chunksOf(bytes.slice(0, 10), bytes.slice(10, cut), bytes.slice(cut)), handlers, emit);

    const iterator = queries[0]?.params.prompt[Symbol.asyncIterator]();
    expect((await iterator?.next())?.value).toMatchObject({ message: { content: "héllo wörld" } });
  });

  test("processes a final line without a trailing newline when stdin closes", async () => {
    const { handlers, events, emit } = setup();
    await runCommandLoop(chunksOf(new TextEncoder().encode(JSON.stringify(start))), handlers, emit);

    expect(events).toEqual([
      { type: "session.ready", sessionId: "sid" },
      { type: "session.outputStyles", available: FAKE_OUTPUT_STYLES },
    ]);
  });

  test("handles commands strictly in order", async () => {
    const { handlers, events, emit } = setup();
    const input = new TextEncoder().encode(
      `${encodeLine({ type: "user.message", text: "too early" })}${encodeLine(start)}${encodeLine({ type: "user.message", text: "ok" })}`,
    );

    await runCommandLoop(chunksOf(input), handlers, emit);

    expect(events.map((event) => event.type)).toEqual(["error", "session.ready", "session.outputStyles"]);
  });
});
