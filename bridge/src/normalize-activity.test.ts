import { describe, expect, test } from "bun:test";

import type { BridgeEvent } from "@flare/protocol";

import { FILE, setupNormalizer as setup } from "./testing/normalizer-harness";
import {
  assistantMessage,
  blockStop,
  initMessage,
  inputJsonDelta,
  resultMessage,
  textBlock,
  textDelta,
  toolResultMessage,
  toolUseBlock,
  toolUseStart,
} from "./testing/sdk-messages";

describe("turn.started", () => {
  test("opens a turn with the first thing the main agent says and not again until the result", async () => {
    const { runAll } = setup();
    const events = await runAll(textDelta("Hel"), textDelta("lo"), assistantMessage([textBlock("Hello")]), resultMessage());
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "assistant.delta",
      "assistant.delta",
      "assistant.message",
      "turn.completed",
    ]);
  });

  test("opens the next turn after turn.completed", async () => {
    const { runAll } = setup();
    const events = await runAll(
      assistantMessage([textBlock("one")]),
      resultMessage(),
      assistantMessage([textBlock("two")]),
      resultMessage(),
    );
    expect(events.filter((event) => event.type === "turn.started")).toHaveLength(2);
  });

  test("an interrupted turn closes too", async () => {
    const { runAll } = setup();
    const events = await runAll(
      textDelta("x"),
      resultMessage({ errorSubtype: "error_during_execution", terminalReason: "aborted_streaming" }),
      textDelta("y"),
    );
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "assistant.delta",
      "turn.completed",
      "turn.started",
      "assistant.delta",
    ]);
  });

  test("does not open a turn for system messages, tool results or subagent chatter", async () => {
    const { runAll } = setup();
    const events = await runAll(
      initMessage("forked"),
      toolResultMessage([{ id: "t1", content: "x" }]),
      textDelta("nested", "toolu_task"),
      assistantMessage([textBlock("inner")], { parentToolUseId: "toolu_task" }),
    );
    expect(events.some((event) => event.type === "turn.started")).toBe(false);
  });

  test("a reset session starts counting turns afresh", async () => {
    const { runAll, normalizer } = setup();
    await runAll(textDelta("x"));
    normalizer.reset();
    expect((await runAll(textDelta("y")))[0]).toEqual({ type: "turn.started" });
  });
});

describe("single-file Grep", () => {
  const SEARCH = { pattern: "useEffect", path: "src/a.ts", output_mode: "content" };
  const CONTENT = ["3:useEffect()", "9-context", "18:useEffect()"].join("\n");

  test("reports the matching lines of the file with the pattern", async () => {
    const { run } = setup();
    const events = await run(
      assistantMessage([toolUseBlock("t1", "Grep", SEARCH)]),
      toolResultMessage([{ id: "t1", content: CONTENT }], { mode: "content", numFiles: 0, filenames: [], content: CONTENT }),
    );
    expect(events.filter((event) => event.type === "file.read")).toEqual([
      { type: "file.read", toolUseId: "t1", path: FILE, pattern: "useEffect", matchLines: [3, 18] },
    ]);
  });

  test("falls back to one file.read per matched file for a listing", async () => {
    const { run } = setup();
    const events = await run(
      assistantMessage([toolUseBlock("t1", "Grep", { pattern: "x", output_mode: "files_with_matches" })]),
      toolResultMessage([{ id: "t1", content: "src/a.ts" }], { mode: "files_with_matches", filenames: ["src/a.ts"] }),
    );
    expect(events.filter((event) => event.type === "file.read")).toEqual([{ type: "file.read", toolUseId: "t1", path: FILE }]);
  });

  test("reports nothing for a content search over a directory", async () => {
    const { run } = setup();
    const content = ["src/a.ts:3:x", "src/b.ts:4:x"].join("\n");
    const events = await run(
      assistantMessage([toolUseBlock("t1", "Grep", { pattern: "x", path: "src", output_mode: "content" })]),
      toolResultMessage([{ id: "t1", content }], { mode: "content", numFiles: 0, filenames: [], content }),
    );
    expect(events.some((event) => event.type === "file.read")).toBe(false);
  });
});

describe("file.editing", () => {
  test("streams the typed edit, then the change arrives before the tool finishes", async () => {
    const { fs, normalizer, run, clock } = setup({ [FILE]: "const a = 1;\n" });
    const input = { file_path: "src/a.ts", old_string: "1", new_string: "2" };
    const json = JSON.stringify(input);
    const cut = json.indexOf('"2"') + 1;

    const typed: BridgeEvent[] = [];
    typed.push(...(await run(toolUseStart(0, "t1", "Edit"))));
    clock.now += 100;
    typed.push(...(await run(inputJsonDelta(0, json.slice(0, cut)))));
    clock.now += 100;
    typed.push(...(await run(inputJsonDelta(0, json.slice(cut)), blockStop(0))));
    await run(assistantMessage([toolUseBlock("t1", "Edit", input)]));
    await normalizer.beginTool("t1", "Edit", input);
    fs.write(FILE, "const a = 2;\n");
    const finished = await run(toolResultMessage([{ id: "t1", content: "updated" }]));

    expect(typed.map((event) => event.type)).toEqual(["file.editing", "file.editing"]);
    expect(typed.at(-1)).toEqual({ type: "file.editing", toolUseId: "t1", path: FILE, kind: "edit", oldString: "1", text: "2" });
    expect(finished.map((event) => event.type)).toEqual(["file.change", "tool.finished"]);
  });

  test("a result ends any edit that was still streaming", async () => {
    const { run, clock } = setup();
    await run(toolUseStart(0, "t1", "Write"));
    await run(resultMessage());
    clock.now += 100;
    expect(await run(inputJsonDelta(0, '{"file_path": "a.ts", "content": "x"}'))).toEqual([]);
  });
});
