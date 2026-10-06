import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { DEFAULT_READ_LINE_LIMIT } from "./tools";
import { MAX_SUMMARY_CHARS } from "./summary";
import { CWD, FILE, setupNormalizer as setup } from "./testing/normalizer-harness";
import {
  assistantMessage,
  initMessage,
  resultMessage,
  SESSION_ID,
  textBlock,
  textDelta,
  thinkingDelta,
  toolResultMessage,
  toolUseBlock,
} from "./testing/sdk-messages";

describe("streaming text", () => {
  test("turns text deltas into assistant.delta", async () => {
    const { run } = setup();
    expect(await run(textDelta("Hel"), textDelta("lo"))).toEqual([
      { type: "assistant.delta", text: "Hel" },
      { type: "assistant.delta", text: "lo" },
    ]);
  });

  test("ignores thinking deltas and deltas from subagents", async () => {
    const { run } = setup();
    expect(await run(thinkingDelta("hmm"), textDelta("nested", "toolu_task"))).toEqual([]);
  });

  test("turns a complete assistant message into assistant.message keyed by its uuid", async () => {
    const { run } = setup();
    const message = assistantMessage([textBlock("Hello "), textBlock("world")]);
    expect(await run(message)).toEqual([{ type: "assistant.message", id: message.uuid, text: "Hello world" }]);
  });

  test("skips assistant messages without text and subagent text", async () => {
    const { run } = setup();
    expect(await run(assistantMessage([textBlock("")]))).toEqual([]);
    expect(await run(assistantMessage([textBlock("inner")], { parentToolUseId: "toolu_task" }))).toEqual([]);
  });

  test("ignores message types the app does not model", async () => {
    const { run } = setup();
    const status: SDKMessage = {
      type: "system",
      subtype: "status",
      status: null,
      uuid: "00000000-0000-4000-8000-0000000000aa",
      session_id: SESSION_ID,
    };
    expect(await run(status)).toEqual([]);
  });
});

describe("tool lifecycle", () => {
  test("emits tool.started with the parsed input", async () => {
    const { run } = setup();
    const events = await run(assistantMessage([toolUseBlock("t1", "Bash", { command: "ls" })]));
    expect(events).toEqual([{ type: "tool.started", toolUseId: "t1", name: "Bash", input: { command: "ls" } }]);
  });

  test("keeps a non-object tool input instead of dropping it", async () => {
    const { run } = setup();
    const events = await run(assistantMessage([toolUseBlock("t1", "Weird", "just a string")]));
    expect(events).toEqual([{ type: "tool.started", toolUseId: "t1", name: "Weird", input: { value: "just a string" } }]);
  });

  test("emits file.read right away for Read", async () => {
    const { run } = setup();
    const events = await run(assistantMessage([toolUseBlock("t1", "Read", { file_path: "src/a.ts" })]));
    expect(events).toEqual([
      { type: "tool.started", toolUseId: "t1", name: "Read", input: { file_path: "src/a.ts" } },
      { type: "file.read", toolUseId: "t1", path: FILE, range: { start: 1, end: DEFAULT_READ_LINE_LIMIT } },
    ]);
  });

  test("puts the offset and limit of a Read into the range", async () => {
    const { run } = setup();
    const events = await run(
      assistantMessage([toolUseBlock("t1", "Read", { file_path: "src/a.ts", offset: 120, limit: 40 })]),
    );
    expect(events.at(-1)).toEqual({ type: "file.read", toolUseId: "t1", path: FILE, range: { start: 120, end: 159 } });
  });

  test("emits tool.finished with a text summary and the error flag", async () => {
    const { run } = setup();
    const events = await run(
      assistantMessage([toolUseBlock("t1", "Bash", { command: "ls" })]),
      toolResultMessage([{ id: "t1", content: [{ type: "text", text: "a.ts" }, { type: "text", text: "b.ts" }], isError: true }]),
    );
    expect(events.at(-1)).toEqual({ type: "tool.finished", toolUseId: "t1", isError: true, summary: "a.ts\nb.ts" });
  });

  test("truncates long summaries", async () => {
    const { run } = setup();
    const events = await run(toolResultMessage([{ id: "t1", content: "x".repeat(MAX_SUMMARY_CHARS + 500) }]));
    const [finished] = events;
    expect(finished?.type === "tool.finished" && finished.summary.length < MAX_SUMMARY_CHARS + 100).toBe(true);
    expect(finished?.type === "tool.finished" && finished.summary.endsWith("(500 more characters)")).toBe(true);
  });

  test("emits events for several tool uses in one assistant message", async () => {
    const { run } = setup();
    const events = await run(
      assistantMessage([toolUseBlock("t1", "Bash", { command: "ls" }), toolUseBlock("t2", "Read", { file_path: "src/a.ts" })]),
    );
    expect(events.map((event) => event.type)).toEqual(["tool.started", "tool.started", "file.read"]);
  });

  test("still reports tools started by subagents", async () => {
    const { run } = setup();
    const events = await run(
      assistantMessage([textBlock("inner"), toolUseBlock("t9", "Bash", { command: "pwd" })], { parentToolUseId: "toolu_task" }),
    );
    expect(events.map((event) => event.type)).toEqual(["tool.started"]);
  });
});

describe("search tools", () => {
  test("emits a file.read per matched file for Grep and Glob", async () => {
    const { run } = setup();
    const events = await run(
      assistantMessage([toolUseBlock("t1", "Glob", { pattern: "**/*.ts" })]),
      toolResultMessage([{ id: "t1", content: "src/a.ts\nsrc/b.ts" }], { filenames: ["src/a.ts", "src/b.ts"], numFiles: 2 }),
    );
    expect(events.filter((event) => event.type === "file.read")).toEqual([
      { type: "file.read", toolUseId: "t1", path: resolve(CWD, "src/a.ts") },
      { type: "file.read", toolUseId: "t1", path: resolve(CWD, "src/b.ts") },
    ]);
  });

  test("emits no file.read when the search failed or has no structured result", async () => {
    const { run } = setup();
    const failed = await run(
      assistantMessage([toolUseBlock("t1", "Grep", { pattern: "x" })]),
      toolResultMessage([{ id: "t1", content: "boom", isError: true }], { filenames: ["src/a.ts"] }),
    );
    const bare = await run(
      assistantMessage([toolUseBlock("t2", "Grep", { pattern: "x" })]),
      toolResultMessage([{ id: "t2", content: "src/a.ts" }]),
    );
    expect(failed.some((event) => event.type === "file.read")).toBe(false);
    expect(bare.some((event) => event.type === "file.read")).toBe(false);
  });

  test("does not attribute a structured result to several parallel tool results", async () => {
    const { run } = setup();
    const events = await run(
      assistantMessage([toolUseBlock("t1", "Grep", { pattern: "x" }), toolUseBlock("t2", "Glob", { pattern: "y" })]),
      toolResultMessage([{ id: "t1", content: "a" }, { id: "t2", content: "b" }], { filenames: ["src/a.ts"] }),
    );
    expect(events.some((event) => event.type === "file.read")).toBe(false);
  });
});

describe("file.change before/after capture", () => {
  test("captures before when the hook fires and after when the tool result arrives", async () => {
    const { fs, normalizer, run } = setup({ [FILE]: "const a = 1;\n" });
    const input = { file_path: "src/a.ts", old_string: "1", new_string: "2" };

    const started = await run(assistantMessage([toolUseBlock("t1", "Edit", input)]));
    await normalizer.beginTool("t1", "Edit", input);
    fs.write(FILE, "const a = 2;\n");
    const finished = await run(toolResultMessage([{ id: "t1", content: "updated" }]));

    expect(started.map((event) => event.type)).toEqual(["tool.started"]);
    expect(finished).toEqual([
      { type: "file.change", toolUseId: "t1", path: FILE, kind: "update", before: "const a = 1;\n", after: "const a = 2;\n" },
      { type: "tool.finished", toolUseId: "t1", isError: false, summary: "updated" },
    ]);
  });

  test("uses the content from the hook even if the assistant message is processed after the edit", async () => {
    const { fs, normalizer, run } = setup({ [FILE]: "old" });
    const input = { file_path: FILE, content: "new" };

    await normalizer.beginTool("t1", "Write", input);
    fs.write(FILE, "new");
    await run(assistantMessage([toolUseBlock("t1", "Write", input)]));
    const finished = await run(toolResultMessage([{ id: "t1", content: "ok" }]));

    expect(finished.find((event) => event.type === "file.change")).toMatchObject({ before: "old", after: "new" });
  });

  test("falls back to capturing when the assistant message arrives without a hook", async () => {
    const { fs, run } = setup({ [FILE]: "old" });
    const input = { file_path: FILE, content: "new" };

    await run(assistantMessage([toolUseBlock("t1", "Write", input)]));
    fs.write(FILE, "new");
    const finished = await run(toolResultMessage([{ id: "t1", content: "ok" }]));

    expect(finished.find((event) => event.type === "file.change")).toMatchObject({ before: "old", after: "new" });
  });

  test("reports a Write to a new file as a create", async () => {
    const { fs, normalizer, run } = setup();
    const input = { file_path: FILE, content: "export {};\n" };

    await run(assistantMessage([toolUseBlock("t1", "Write", input)]));
    await normalizer.beginTool("t1", "Write", input);
    fs.write(FILE, "export {};\n");
    const finished = await run(toolResultMessage([{ id: "t1", content: "created" }]));

    expect(finished.find((event) => event.type === "file.change")).toEqual({
      type: "file.change",
      toolUseId: "t1",
      path: FILE,
      kind: "create",
      before: null,
      after: "export {};\n",
    });
  });

  test("handles MultiEdit like Edit", async () => {
    const { fs, normalizer, run } = setup({ [FILE]: "a b" });
    const input = { file_path: FILE, edits: [{ old_string: "a", new_string: "x" }] };

    await run(assistantMessage([toolUseBlock("t1", "MultiEdit", input)]));
    await normalizer.beginTool("t1", "MultiEdit", input);
    fs.write(FILE, "x b");

    const finished = await run(toolResultMessage([{ id: "t1", content: "ok" }]));
    expect(finished.find((event) => event.type === "file.change")).toMatchObject({ before: "a b", after: "x b" });
  });

  test("emits no file.change when the tool failed", async () => {
    const { fs, normalizer, run } = setup({ [FILE]: "old" });
    const input = { file_path: FILE, old_string: "zzz", new_string: "y" };

    await run(assistantMessage([toolUseBlock("t1", "Edit", input)]));
    await normalizer.beginTool("t1", "Edit", input);
    fs.write(FILE, "old");
    const finished = await run(toolResultMessage([{ id: "t1", content: "string not found", isError: true }]));

    expect(finished.map((event) => event.type)).toEqual(["tool.finished"]);
  });

  test("reports an unreadable file as an error event", async () => {
    const { fs, normalizer, run } = setup({ [FILE]: "old" });
    fs.failReads(FILE, "file is too large");
    const input = { file_path: FILE, old_string: "o", new_string: "n" };

    await run(assistantMessage([toolUseBlock("t1", "Edit", input)]));
    await normalizer.beginTool("t1", "Edit", input);
    const finished = await run(toolResultMessage([{ id: "t1", content: "ok" }]));

    expect(finished.find((event) => event.type === "error")).toEqual({
      type: "error",
      message: `Could not capture ${FILE} before the change: file is too large`,
    });
  });

  test("does not capture for tools that do not change files", async () => {
    const { normalizer, run } = setup({ [FILE]: "x" });
    await normalizer.beginTool("t1", "Bash", { command: "rm src/a.ts" });
    await run(assistantMessage([toolUseBlock("t1", "Bash", { command: "rm src/a.ts" })]));
    const finished = await run(toolResultMessage([{ id: "t1", content: "" }]));
    expect(finished.map((event) => event.type)).toEqual(["tool.finished"]);
  });
});

describe("session and turn events", () => {
  test("emits session.ready only when the reported session id differs", async () => {
    const { run } = setup();
    expect(await run(initMessage(SESSION_ID))).toEqual([]);
    expect(await run(initMessage("forked-session"))).toEqual([{ type: "session.ready", sessionId: "forked-session" }]);
    expect(await run(initMessage("forked-session"))).toEqual([]);
  });

  test("turns a result into turn.completed with the usage totals", async () => {
    const { run } = setup();
    expect(await run(resultMessage({ costUsd: 1.5 }))).toEqual([
      {
        type: "turn.completed",
        costUsd: 1.5,
        usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 10, cacheCreationInputTokens: 5 },
      },
    ]);
  });

  test("reports an error result before completing the turn", async () => {
    const { run } = setup();
    const events = await run(resultMessage({ errorSubtype: "error_max_turns", errors: ["too many turns", "stop"] }));
    expect(events.map((event) => event.type)).toEqual(["error", "turn.completed"]);
    expect(events[0]).toEqual({ type: "error", message: "too many turns\nstop" });
  });

  test("falls back to the subtype when an error result has no messages", async () => {
    const { run } = setup();
    const [error] = await run(resultMessage({ errorSubtype: "error_during_execution" }));
    expect(error).toEqual({ type: "error", message: "The turn ended with error_during_execution" });
  });

  test("treats a successful result flagged as an error as an error", async () => {
    const { run } = setup();
    const events = await run(resultMessage({ isError: true, result: "Credit balance is too low" }));
    expect(events[0]).toEqual({ type: "error", message: "Credit balance is too low" });
  });

  test("does not report an interrupted turn as an error", async () => {
    const { run } = setup();
    const events = await run(
      resultMessage({ errorSubtype: "error_during_execution", terminalReason: "aborted_streaming" }),
    );
    expect(events.map((event) => event.type)).toEqual(["turn.completed"]);
  });

  test("reports an API error flagged on an assistant message once, not as text", async () => {
    const { run } = setup();
    const events = await run(
      assistantMessage([textBlock("API Error: overloaded")], { error: "overloaded" }),
      resultMessage({ isError: true, result: "API Error: overloaded" }),
    );
    expect(events.map((event) => event.type)).toEqual(["error", "turn.completed"]);
    expect(events[0]).toEqual({ type: "error", message: "API Error: overloaded" });
  });
});
