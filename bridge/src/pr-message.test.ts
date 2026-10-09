import { describe, expect, test } from "bun:test";

import { COMMIT_MESSAGE_MODEL } from "@flare/protocol";

import { answer } from "./testing/one-shot-harness";
import { createPullRequestHarness, pullRequestRequest } from "./testing/pr-harness";
import { resultMessage } from "./testing/sdk-messages";

const BODY = "## Summary\n- Add a login form.\n\n## Why\nUsers could not sign in.";
const reply = (title: string, body: string | null = BODY) => JSON.stringify({ title, body });

describe("PullRequestGenerator", () => {
  test("emits pr.generated for a valid reply", async () => {
    const { generator, events, queries } = createPullRequestHarness();

    generator.request(pullRequestRequest());
    answer(queries[0], reply("feat(auth): add login"));
    await generator.settled();

    expect(events).toEqual([{ type: "pr.generated", requestId: "p1", title: "feat(auth): add login", body: BODY }]);
  });

  test("runs a tool free, single turn query on the shared model with no settings loaded", async () => {
    const { generator, queries } = createPullRequestHarness();

    generator.request(pullRequestRequest());
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
    expect(options?.systemPrompt).toContain("pull request titles and descriptions");
  });

  test("sends the branches, commits and stat as the prompt", async () => {
    const { generator, queries } = createPullRequestHarness();

    generator.request(pullRequestRequest());
    answer(queries[0], reply("fix: x"));
    await generator.settled();

    const prompt = queries[0]?.params.prompt;
    expect(prompt).toContain("Branch: feat/login");
    expect(prompt).toContain("fix(auth): trim the email");
    expect(prompt).toContain("src/login.test.ts");
  });

  test("drops a Test plan the stat does not justify", async () => {
    const { generator, events, queries } = createPullRequestHarness();

    generator.request(pullRequestRequest({ stat: " src/login.ts | 10 ++++" }));
    answer(queries[0], reply("fix: x", `${BODY}\n\n## Test plan\n- [ ] Sign in.`));
    await generator.settled();

    expect(events).toEqual([{ type: "pr.generated", requestId: "p1", title: "fix: x", body: BODY }]);
  });

  test("answers concurrent requests independently, by request id", async () => {
    const { generator, events, queries } = createPullRequestHarness();

    generator.request(pullRequestRequest({ requestId: "first" }));
    generator.request(pullRequestRequest({ requestId: "second" }));
    generator.request(pullRequestRequest({ requestId: "third" }));
    expect(queries).toHaveLength(3);

    answer(queries[1], reply("fix: second", "second body"));
    answer(queries[2], '{"subject":"not the expected shape"}');
    answer(queries[0], reply("fix: first", ""));
    await generator.settled();

    expect(events).toHaveLength(3);
    expect(events).toContainEqual({ type: "pr.generated", requestId: "first", title: "fix: first", body: "" });
    expect(events).toContainEqual({ type: "pr.generated", requestId: "second", title: "fix: second", body: "second body" });
    expect(events.find((event) => event.type === "pr.failed" && event.requestId === "third")).toBeDefined();
  });

  test("rejects a request id that is already running and accepts it again once it is done", async () => {
    const { generator, events, queries } = createPullRequestHarness();

    generator.request(pullRequestRequest());
    expect(() => {
      generator.request(pullRequestRequest());
    }).toThrow("Request p1 for a pull request description is already running");

    answer(queries[0], reply("fix: x"));
    await generator.settled();
    generator.request(pullRequestRequest());
    answer(queries[1], reply("fix: y"));
    await generator.settled();

    expect(events.map((event) => event.type)).toEqual(["pr.generated", "pr.generated"]);
  });

  test("only ever emits pull request events", async () => {
    const { generator, events, queries } = createPullRequestHarness();

    generator.request(pullRequestRequest());
    answer(queries[0], reply("fix: x"));
    generator.request(pullRequestRequest({ requestId: "p2" }));
    queries[1]?.fail(new Error("boom"));
    await generator.settled();

    expect(events.every((event) => event.type.startsWith("pr."))).toBe(true);
  });

  test("close() closes every query that is still running", async () => {
    const { generator, queries } = createPullRequestHarness();

    generator.request(pullRequestRequest({ requestId: "a" }));
    generator.request(pullRequestRequest({ requestId: "b" }));
    generator.close();

    expect(queries.map((query) => query.calls)).toEqual([["close"], ["close"]]);

    queries[0]?.end();
    queries[1]?.end();
    await generator.settled();
  });

  describe("failures", () => {
    test("reports an over-long title", async () => {
      const { generator, events, queries } = createPullRequestHarness();

      generator.request(pullRequestRequest());
      answer(queries[0], reply(`feat: ${"x".repeat(100)}`));
      await generator.settled();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "pr.failed", requestId: "p1" });
      expect(events[0]).toHaveProperty("message", expect.stringContaining("over the 72 limit"));
    });

    test("reports an empty reply", async () => {
      const { generator, events, queries } = createPullRequestHarness();

      generator.request(pullRequestRequest());
      queries[0]?.push(resultMessage({ result: " " }));
      await generator.settled();

      expect(events).toEqual([
        { type: "pr.failed", requestId: "p1", message: "Claude returned an empty pull request description." },
      ]);
    });

    test("reports a reply without a title", async () => {
      const { generator, events, queries } = createPullRequestHarness();

      generator.request(pullRequestRequest());
      answer(queries[0], reply(""));
      await generator.settled();

      expect(events).toEqual([
        { type: "pr.failed", requestId: "p1", message: "Claude returned a pull request without a title." },
      ]);
    });

    test("reports a stream that ends without any reply", async () => {
      const { generator, events, queries } = createPullRequestHarness();

      generator.request(pullRequestRequest());
      queries[0]?.end();
      await generator.settled();

      expect(events).toEqual([
        { type: "pr.failed", requestId: "p1", message: "Claude ended without writing a pull request description." },
      ]);
    });

    test("reports an error result with its reason", async () => {
      const { generator, events, queries } = createPullRequestHarness();

      generator.request(pullRequestRequest());
      queries[0]?.push(resultMessage({ errorSubtype: "error_max_turns", errors: ["too many turns"] }));
      await generator.settled();

      expect(events).toEqual([
        {
          type: "pr.failed",
          requestId: "p1",
          message: "Claude could not write a pull request description: too many turns",
        },
      ]);
    });

    test("reports a query that throws, logs it and closes the query", async () => {
      const { generator, events, logs, queries } = createPullRequestHarness();

      generator.request(pullRequestRequest());
      queries[0]?.fail(new Error("Claude Code exited with code 1"));
      await generator.settled();

      expect(events).toEqual([{ type: "pr.failed", requestId: "p1", message: "Claude Code exited with code 1" }]);
      expect(logs.join("\n")).toContain("pull request description p1 failed: Claude Code exited with code 1");
      expect(queries[0]?.calls).toEqual(["close"]);
    });

    test("reports a missing claude executable without starting a query", async () => {
      const { generator, events, queries } = createPullRequestHarness({
        resolveClaudeExecutable: () => {
          throw new Error("Could not find `claude` on PATH.");
        },
      });

      generator.request(pullRequestRequest());
      await generator.settled();

      expect(queries).toHaveLength(0);
      expect(events).toEqual([{ type: "pr.failed", requestId: "p1", message: "Could not find `claude` on PATH." }]);
    });

    test("refuses to describe a branch with no commits and no changes without starting a query", async () => {
      const { generator, events, queries } = createPullRequestHarness();

      generator.request(pullRequestRequest({ commits: [], stat: " \n" }));
      await generator.settled();

      expect(queries).toHaveLength(0);
      expect(events).toEqual([{ type: "pr.failed", requestId: "p1", message: "There are no commits to describe." }]);
    });

    test("still describes commits when the stat is empty", async () => {
      const { generator, events, queries } = createPullRequestHarness();

      generator.request(pullRequestRequest({ stat: "" }));
      answer(queries[0], reply("fix: x"));
      await generator.settled();

      expect(events.map((event) => event.type)).toEqual(["pr.generated"]);
    });

    test("fails a request that never gets an answer and closes its query", async () => {
      const { generator, events, queries } = createPullRequestHarness({ timeoutMs: 20 });

      generator.request(pullRequestRequest());
      await generator.settled();

      expect(events).toEqual([
        {
          type: "pr.failed",
          requestId: "p1",
          message: "Claude took longer than 0.02s to write a pull request description.",
        },
      ]);
      expect(queries[0]?.calls).toEqual(["close"]);
    });
  });
});
