import { describe, expect, test } from "bun:test";

import type { ChatItem } from "@/features/agent/thread-types";

import { turnAnchorAt } from "./turn-anchor";

const user = (id: string): ChatItem => ({ kind: "user", id, text: id });
const assistant = (id: string): ChatItem => ({ kind: "assistant", id, text: id, streaming: false });
const tool = (id: string): ChatItem => ({
  kind: "tool",
  id,
  name: "Edit",
  input: {},
  status: "done",
  summary: "",
  touched: [],
});

describe("turnAnchorAt", () => {
  const items = [user("u1"), assistant("a1"), tool("t1"), assistant("a2"), user("u2"), assistant("a3")];

  test("only the last row of a turn carries the footer", () => {
    expect(items.map((_, index) => turnAnchorAt(items, index))).toEqual([null, null, null, "u1", null, "u2"]);
  });

  test("a turn that has only its user message is complete on that row", () => {
    expect(turnAnchorAt([user("u1")], 0)).toBe("u1");
  });

  test("a notice at the end of a turn is its last row", () => {
    const withNotice = [user("u1"), assistant("a1"), { kind: "notice", id: "n1", text: "stopped" } satisfies ChatItem];
    expect(withNotice.map((_, index) => turnAnchorAt(withNotice, index))).toEqual([null, null, "u1"]);
  });

  test("rows before any user message belong to no turn", () => {
    expect(turnAnchorAt([assistant("a0"), user("u1")], 0)).toBeNull();
  });

  test("an empty or out-of-range position has no anchor", () => {
    expect(turnAnchorAt([], 0)).toBeNull();
    expect(turnAnchorAt([user("u1")], 5)).toBe("u1");
  });
});
