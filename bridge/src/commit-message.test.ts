import { describe, expect, test } from "bun:test";

import { COMMIT_MESSAGE_MODEL } from "@flare/protocol";

import { commitRequest, createCommitHarness } from "./testing/commit-harness";
import type { FakeQuery } from "./testing/fake-query";
import { assistantMessage, resultMessage, textBlock } from "./testing/sdk-messages";

const reply = (subject: string, body: string | null = null) => JSON.stringify({ subject, body });

function answer(query: FakeQuery<string> | undefined, text: string): void {
  query?.push(assistantMessage([textBlock(text)]));
  query?.push(resultMessage({ result: text }));
}

describe("CommitMessageGenerator", () => {
  test("emits commit.generated for a valid reply", async () => {
    const { generator, events, queries } = createCommitHarness();

    generator.request(commitRequest({ includeBody: true }));
    answer(queries[0], reply("feat(vcs): add the Changes tab", "Committing from the app saves a terminal trip."));
    await generator.settled();

    expect(events).toEqual([
      {
        type: "commit.generated",
        requestId: "c1",
        subject: "feat(vcs): add the Changes tab",
        body: "Committing from the app saves a terminal trip.",
      },
    ]);
  });

  test("leaves the body out unless asked for one", async () => {
    const { generator, events, queries } = createCommitHarness();

    generator.request(commitRequest({ includeBody: false }));
    answer(queries[0], reply("fix: x", "ignored because no body was requested"));
    await generator.settled();

    expect(events).toEqual([{ type: "commit.generated", requestId: "c1", subject: "fix: x", body: null }]);
  });

  test("runs a tool free, single turn query on the commit model with no settings loaded", async () => {
    const { generator, queries } = createCommitHarness();

    generator.request(commitRequest({ includeBody: true }));
    answer(queries[0], reply("fix: x"));
    await generator.settled();

    const options = queries[0]?.params.options;
    expect(options).toMatchObject({
      model: COMMIT_MESSAGE_MODEL,
      pathToClaudeCodeExecutable: "claude.exe",
      tools: [],
      permissionMode: "dontAsk",
      maxTurns: 1,
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      thinking: { type: "disabled" },
    });
    expect(options?.canUseTool).toBeUndefined();
    expect(options?.allowedTools).toBeUndefined();
    expect(options?.systemPrompt).toContain("Conventional Commits");
    expect(options?.systemPrompt).toContain("Wrap lines at 72");
  });

  test("sends the diff, stat and recent subjects as the prompt", async () => {
    const { generator, queries } = createCommitHarness();

    generator.request(commitRequest());
    answer(queries[0], reply("fix: x"));
    await generator.settled();

    const prompt = queries[0]?.params.prompt;
    expect(prompt).toContain("feat(chat): stream replies");
    expect(prompt).toContain("1 file changed");
    expect(prompt).toContain("+const a = 2;");
  });

  test("closes its query once it has an answer", async () => {
    const { generator, queries } = createCommitHarness();

    generator.request(commitRequest());
    answer(queries[0], reply("fix: x"));
    await generator.settled();

    expect(queries[0]?.calls).toEqual(["close"]);
  });

  test("answers concurrent requests independently, by request id", async () => {
    const { generator, events, queries } = createCommitHarness();

    generator.request(commitRequest({ requestId: "first" }));
    generator.request(commitRequest({ requestId: "second", includeBody: true }));
    generator.request(commitRequest({ requestId: "third" }));
    expect(queries).toHaveLength(3);

    answer(queries[1], reply("fix: second", "second body"));
    answer(queries[2], '{"message":"not the expected shape"}');
    answer(queries[0], reply("fix: first"));
    await generator.settled();

    expect(events).toHaveLength(3);
    expect(events).toContainEqual({ type: "commit.generated", requestId: "first", subject: "fix: first", body: null });
    expect(events).toContainEqual({
      type: "commit.generated",
      requestId: "second",
      subject: "fix: second",
      body: "second body",
    });
    expect(events.find((event) => event.type === "commit.failed" && event.requestId === "third")).toBeDefined();
  });

  test("rejects a request id that is already running and accepts it again once it is done", async () => {
    const { generator, events, queries } = createCommitHarness();

    generator.request(commitRequest());
    expect(() => {
      generator.request(commitRequest());
    }).toThrow("Commit message request c1 is already running");

    answer(queries[0], reply("fix: x"));
    await generator.settled();
    generator.request(commitRequest());
    answer(queries[1], reply("fix: y"));
    await generator.settled();

    expect(events.map((event) => event.type)).toEqual(["commit.generated", "commit.generated"]);
  });

  test("uses the assistant text when the result carries none", async () => {
    const { generator, events, queries } = createCommitHarness();

    generator.request(commitRequest());
    queries[0]?.push(assistantMessage([textBlock(reply("fix: from assistant"))]));
    queries[0]?.push(resultMessage({ result: "" }));
    await generator.settled();

    expect(events).toEqual([{ type: "commit.generated", requestId: "c1", subject: "fix: from assistant", body: null }]);
  });

  test("falls back to plain text when the model ignores the JSON format", async () => {
    const { generator, events, queries } = createCommitHarness();

    generator.request(commitRequest({ includeBody: true }));
    answer(queries[0], "fix(a): handle the empty case\n\nIt used to crash.");
    await generator.settled();

    expect(events).toEqual([
      {
        type: "commit.generated",
        requestId: "c1",
        subject: "fix(a): handle the empty case",
        body: "It used to crash.",
      },
    ]);
  });

  describe("failures", () => {
    test("reports an empty reply", async () => {
      const { generator, events, queries } = createCommitHarness();

      generator.request(commitRequest());
      queries[0]?.push(resultMessage({ result: "  " }));
      await generator.settled();

      expect(events).toEqual([
        { type: "commit.failed", requestId: "c1", message: "Claude returned an empty commit message." },
      ]);
    });

    test("reports a stream that ends without any reply", async () => {
      const { generator, events, queries } = createCommitHarness();

      generator.request(commitRequest());
      queries[0]?.end();
      await generator.settled();

      expect(events).toEqual([
        { type: "commit.failed", requestId: "c1", message: "Claude ended without writing a commit message." },
      ]);
    });

    test("reports a subject that is too long", async () => {
      const { generator, events, queries } = createCommitHarness();

      generator.request(commitRequest());
      answer(queries[0], reply(`feat: ${"x".repeat(100)}`));
      await generator.settled();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "commit.failed", requestId: "c1" });
      expect(events[0]).toHaveProperty("message", expect.stringContaining("over the 72 limit"));
    });

    test("reports an error result with its reason", async () => {
      const { generator, events, queries } = createCommitHarness();

      generator.request(commitRequest());
      queries[0]?.push(resultMessage({ errorSubtype: "error_max_turns", errors: ["too many turns"] }));
      await generator.settled();

      expect(events).toEqual([
        { type: "commit.failed", requestId: "c1", message: "Claude could not write a commit message: too many turns" },
      ]);
    });

    test("reports an error flagged on a success result", async () => {
      const { generator, events, queries } = createCommitHarness();

      generator.request(commitRequest());
      queries[0]?.push(resultMessage({ isError: true, result: "Invalid API key" }));
      await generator.settled();

      expect(events).toEqual([{ type: "commit.failed", requestId: "c1", message: "Invalid API key" }]);
    });

    test("reports a query that throws", async () => {
      const { generator, events, logs, queries } = createCommitHarness();

      generator.request(commitRequest());
      queries[0]?.fail(new Error("Claude Code exited with code 1"));
      await generator.settled();

      expect(events).toEqual([{ type: "commit.failed", requestId: "c1", message: "Claude Code exited with code 1" }]);
      expect(logs.join("\n")).toContain("Claude Code exited with code 1");
      expect(queries[0]?.calls).toEqual(["close"]);
    });

    test("reports a missing claude executable without starting a query", async () => {
      const { generator, events, queries } = createCommitHarness({
        resolveClaudeExecutable: () => {
          throw new Error("Could not find `claude` on PATH.");
        },
      });

      generator.request(commitRequest());
      await generator.settled();

      expect(queries).toHaveLength(0);
      expect(events).toEqual([{ type: "commit.failed", requestId: "c1", message: "Could not find `claude` on PATH." }]);
    });

    test("refuses to describe an empty diff without starting a query", async () => {
      const { generator, events, queries } = createCommitHarness();

      generator.request(commitRequest({ stat: "", patch: " \n" }));
      await generator.settled();

      expect(queries).toHaveLength(0);
      expect(events).toEqual([{ type: "commit.failed", requestId: "c1", message: "There are no changes to describe." }]);
    });

    test("fails a request that never gets an answer and closes its query", async () => {
      const { generator, events, queries } = createCommitHarness({ timeoutMs: 20 });

      generator.request(commitRequest());
      await generator.settled();

      expect(events).toEqual([
        { type: "commit.failed", requestId: "c1", message: "Claude took longer than 0.02s to write a commit message." },
      ]);
      expect(queries[0]?.calls).toEqual(["close"]);
    });

    test("keeps other requests alive when one fails", async () => {
      const { generator, events, queries } = createCommitHarness();

      generator.request(commitRequest({ requestId: "bad" }));
      generator.request(commitRequest({ requestId: "good" }));
      queries[0]?.fail(new Error("boom"));
      answer(queries[1], reply("fix: still works"));
      await generator.settled();

      expect(events).toContainEqual({ type: "commit.failed", requestId: "bad", message: "boom" });
      expect(events).toContainEqual({
        type: "commit.generated",
        requestId: "good",
        subject: "fix: still works",
        body: null,
      });
    });
  });

  test("close() closes every query that is still running", async () => {
    const { generator, queries } = createCommitHarness();

    generator.request(commitRequest({ requestId: "a" }));
    generator.request(commitRequest({ requestId: "b" }));
    generator.close();

    expect(queries.map((query) => query.calls)).toEqual([["close"], ["close"]]);

    queries[0]?.end();
    queries[1]?.end();
    await generator.settled();
    expect(queries.map((query) => query.calls)).toEqual([["close"], ["close"]]);
  });

  test("only ever emits commit events", async () => {
    const { generator, events, queries } = createCommitHarness();

    generator.request(commitRequest());
    answer(queries[0], reply("fix: x"));
    await generator.settled();

    expect(events.every((event) => event.type.startsWith("commit."))).toBe(true);
  });
});
