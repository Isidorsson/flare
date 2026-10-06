import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { MAX_EDITING_TEXT_CHARS, type BridgeEvent } from "@flare/protocol";

import { EDITING_THROTTLE_MS, EditStreams } from "./edit-stream";
import { blockStop, inputJsonDelta, messageStop, textDelta, toolUseStart } from "./testing/sdk-messages";

const CWD = resolve("/work/app");
const FILE = resolve(CWD, "src/a.ts");

function setup() {
  const clock = { now: 10_000 };
  const streams = new EditStreams({ cwd: CWD, now: () => clock.now });
  return {
    streams,
    clock,
    tick: (ms = EDITING_THROTTLE_MS) => {
      clock.now += ms;
    },
  };
}

function split(text: string, size: number): string[] {
  return Array.from({ length: Math.ceil(text.length / size) }, (_, index) => text.slice(index * size, (index + 1) * size));
}

function editingOf(events: BridgeEvent[]) {
  return events.filter((event) => event.type === "file.editing");
}

describe("EditStreams for Edit", () => {
  const input = JSON.stringify({ file_path: "src/a.ts", old_string: "const a = 1;", new_string: "const a = 2;\nconst b = 3;" });

  test("reports the typed text once the path and the text to replace are complete", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "Edit"));
    const cut = input.indexOf("new_string") + "new_string\": \"const a".length;
    const events: BridgeEvent[] = [];
    events.push(...streams.handle(inputJsonDelta(0, input.slice(0, cut))));
    tick();
    events.push(...streams.handle(inputJsonDelta(0, input.slice(cut))));
    events.push(...streams.handle(blockStop(0)));

    expect(events).toEqual([
      { type: "file.editing", toolUseId: "t1", path: FILE, kind: "edit", oldString: "const a = 1;", text: "const a " },
      {
        type: "file.editing",
        toolUseId: "t1",
        path: FILE,
        kind: "edit",
        oldString: "const a = 1;",
        text: "const a = 2;\nconst b = 3;",
      },
    ]);
  });

  test("says nothing until the path and the old string have both been typed in full", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "Edit"));
    const stops = [
      input.indexOf("src") + 2,
      input.indexOf("src/a.ts") + "src/a.ts".length,
      input.indexOf("old_string") + 20,
      input.indexOf("const a = 1;") + 4,
    ];
    let fed = 0;
    for (const stop of stops) {
      tick();
      expect(streams.handle(inputJsonDelta(0, input.slice(fed, stop)))).toEqual([]);
      fed = stop;
    }
  });

  test("reports the old string alone while nothing has been typed into the replacement", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "Edit"));
    tick();
    const events = streams.handle(inputJsonDelta(0, input.slice(0, input.indexOf(',"new_string"') + 1)));
    expect(events).toEqual([
      { type: "file.editing", toolUseId: "t1", path: FILE, kind: "edit", oldString: "const a = 1;", text: "" },
    ]);
  });

  test.each([1, 2, 3, 5, 7, 13])("reaches the same final text with %i-character chunks", (size) => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "Edit"));
    const events: BridgeEvent[] = [];
    for (const chunk of split(input, size)) {
      tick();
      events.push(...streams.handle(inputJsonDelta(0, chunk)));
    }
    events.push(...streams.handle(blockStop(0)));
    expect(editingOf(events).at(-1)).toMatchObject({ text: "const a = 2;\nconst b = 3;", oldString: "const a = 1;" });
  });

  test("only ever shows a prefix of the final text, however escapes are split", () => {
    const text = 'say "hi"\n\ttab \\ back é \u{1f600}';
    const full = JSON.stringify({ file_path: "src/a.ts", old_string: "x", new_string: text });
    for (const size of [1, 2, 3, 4, 6]) {
      const { streams, tick } = setup();
      streams.handle(toolUseStart(0, "t1", "Edit"));
      for (const chunk of split(full, size)) {
        tick();
        for (const event of editingOf(streams.handle(inputJsonDelta(0, chunk)))) {
          expect(text.startsWith(event.text)).toBe(true);
        }
      }
    }
  });
});

describe("EditStreams for Write", () => {
  const input = JSON.stringify({ file_path: "src/new.ts", content: "export const a = 1;\nexport const b = 2;\n" });

  test("reports the whole file typed so far, with no old string", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(2, "t1", "Write"));
    tick();
    const first = streams.handle(inputJsonDelta(2, input.slice(0, input.indexOf("a = 1") + 3)));
    tick();
    const rest = streams.handle(inputJsonDelta(2, input.slice(input.indexOf("a = 1") + 3)));
    expect(first).toEqual([
      { type: "file.editing", toolUseId: "t1", path: resolve(CWD, "src/new.ts"), kind: "write", text: "export const a =" },
    ]);
    expect(rest).toEqual([
      {
        type: "file.editing",
        toolUseId: "t1",
        path: resolve(CWD, "src/new.ts"),
        kind: "write",
        text: "export const a = 1;\nexport const b = 2;\n",
      },
    ]);
  });

  test("reports an empty write as soon as the path is known so the file can open early", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "Write"));
    tick();
    expect(streams.handle(inputJsonDelta(0, '{"file_path": "src/new.ts", '))).toEqual([
      { type: "file.editing", toolUseId: "t1", path: resolve(CWD, "src/new.ts"), kind: "write", text: "" },
    ]);
  });

  test("caps the text that is sent and stops repeating once the cap is reached", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "Write"));
    tick();
    const big = streams.handle(inputJsonDelta(0, `{"file_path": "a.ts", "content": "${"x".repeat(MAX_EDITING_TEXT_CHARS + 500)}`));
    tick();
    const more = streams.handle(inputJsonDelta(0, "yyyy"));
    expect(editingOf(big)[0]?.text).toHaveLength(MAX_EDITING_TEXT_CHARS);
    expect(more).toEqual([]);
  });
});

describe("EditStreams for MultiEdit", () => {
  const edits = [
    { old_string: "one", new_string: "uno" },
    { old_string: "two", new_string: "dos\ndos" },
  ];
  const input = JSON.stringify({ file_path: "src/a.ts", edits });

  test("follows the edit that is being typed, which is the last in the array", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "MultiEdit"));
    const seen: [string | undefined, string][] = [];
    for (const chunk of split(input, 4)) {
      tick();
      for (const event of editingOf(streams.handle(inputJsonDelta(0, chunk)))) seen.push([event.oldString, event.text]);
    }
    for (const event of editingOf(streams.handle(blockStop(0)))) seen.push([event.oldString, event.text]);
    expect(seen[0]).toEqual(["one", ""]);
    expect(seen).toContainEqual(["one", "uno"]);
    expect(seen).toContainEqual(["two", "d"]);
    expect(seen.at(-1)).toEqual(["two", "dos\ndos"]);
  });

  test("says nothing before the first edit has its old string", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "MultiEdit"));
    tick();
    expect(streams.handle(inputJsonDelta(0, '{"file_path": "src/a.ts", "edits": ['))).toEqual([]);
    tick();
    expect(streams.handle(inputJsonDelta(0, '{"old_string": "on'))).toEqual([]);
  });
});

describe("EditStreams throttling and lifecycle", () => {
  const input = JSON.stringify({ file_path: "src/a.ts", old_string: "a", new_string: "abcdefghij" });

  test("emits at most once per throttle window, with the full text so far", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "Edit"));
    const head = input.indexOf("abcdefghij");
    const first = streams.handle(inputJsonDelta(0, input.slice(0, head + 2)));
    const second = streams.handle(inputJsonDelta(0, "c"));
    const third = streams.handle(inputJsonDelta(0, "d"));
    tick(EDITING_THROTTLE_MS - 1);
    const stillThrottled = streams.handle(inputJsonDelta(0, "e"));
    tick(1);
    const next = streams.handle(inputJsonDelta(0, "f"));
    expect(first).toHaveLength(1);
    expect([second, third, stillThrottled]).toEqual([[], [], []]);
    expect(editingOf(next)[0]?.text).toBe("abcdef");
  });

  test("flushes what the throttle held back when the block stops", () => {
    const { streams } = setup();
    streams.handle(toolUseStart(0, "t1", "Edit"));
    streams.handle(inputJsonDelta(0, input.slice(0, input.indexOf("abcdefghij") + 3)));
    streams.handle(inputJsonDelta(0, input.slice(input.indexOf("abcdefghij") + 3)));
    expect(editingOf(streams.handle(blockStop(0)))[0]?.text).toBe("abcdefghij");
  });

  test("does not repeat an unchanged snapshot", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "Edit"));
    tick();
    streams.handle(inputJsonDelta(0, input));
    expect(streams.handle(blockStop(0))).toEqual([]);
  });

  test("tracks parallel tool blocks by index", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "Edit"));
    streams.handle(toolUseStart(1, "t2", "Write"));
    tick();
    const a = streams.handle(inputJsonDelta(1, '{"file_path": "b.ts", "content": "B"}'));
    const b = streams.handle(inputJsonDelta(0, input));
    expect(editingOf(a)[0]).toMatchObject({ toolUseId: "t2", text: "B" });
    expect(editingOf(b)[0]).toMatchObject({ toolUseId: "t1", text: "abcdefghij" });
  });

  test("ignores other tools, text, subagents and unknown blocks", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "Bash"));
    tick();
    expect(streams.handle(inputJsonDelta(0, '{"command": "ls"}'))).toEqual([]);
    expect(streams.handle(inputJsonDelta(9, input))).toEqual([]);
    expect(streams.handle(textDelta("hi"))).toEqual([]);
    expect(streams.handle(blockStop(9))).toEqual([]);
    const nested = { ...toolUseStart(1, "t3", "Edit"), parent_tool_use_id: "toolu_task" };
    streams.handle(nested);
    expect(streams.handle({ ...inputJsonDelta(1, input), parent_tool_use_id: "toolu_task" })).toEqual([]);
  });

  test("forgets open blocks when the message ends or the stream is reset", () => {
    const { streams, tick } = setup();
    streams.handle(toolUseStart(0, "t1", "Edit"));
    streams.handle(messageStop());
    tick();
    expect(streams.handle(inputJsonDelta(0, input))).toEqual([]);
    streams.handle(toolUseStart(0, "t2", "Edit"));
    streams.reset();
    tick();
    expect(streams.handle(inputJsonDelta(0, input))).toEqual([]);
  });
});
