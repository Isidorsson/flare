import { describe, expect, test } from "bun:test";

import { ActionQueue, pauseAfterMs, type Action, type EditAction, type ReadAction } from "./action-queue";

const read = (path: string): ReadAction => ({ kind: "read", path, request: { range: null, pattern: null, matchLines: null } });
const edit = (path: string, overrides: Partial<EditAction> = {}): EditAction => ({
  kind: "edit",
  path,
  before: "a",
  after: "b",
  settled: false,
  forced: false,
  ...overrides,
});

function drain(queue: ActionQueue): Action[] {
  const out: Action[] = [];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) out.push(next);
  return out;
}

describe("ActionQueue ordering", () => {
  test("hands actions out in the order they arrived", () => {
    const queue = new ActionQueue();
    queue.push(read("a"));
    queue.push(edit("b"));
    expect(drain(queue).map((action) => `${action.kind}:${action.path}`)).toEqual(["read:a", "edit:b"]);
  });

  test("puts a front push ahead of what is waiting", () => {
    const queue = new ActionQueue();
    queue.push(read("a"));
    queue.push(edit("b"), { front: true });
    expect(drain(queue).map((action) => action.path)).toEqual(["b", "a"]);
  });

  test("reports its size and can be cleared", () => {
    const queue = new ActionQueue();
    queue.push(read("a"));
    queue.push(read("b"));
    expect(queue.size).toBe(2);
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.shift()).toBeUndefined();
  });
});

describe("ActionQueue dropping reads", () => {
  test("keeps up to three actions as they are", () => {
    const queue = new ActionQueue();
    for (const path of ["a", "b", "c"]) queue.push(read(path));
    expect(drain(queue)).toHaveLength(3);
  });

  test("drops the oldest read once more than three are waiting", () => {
    const queue = new ActionQueue();
    for (const path of ["a", "b", "c", "d", "e"]) queue.push(read(path));
    expect(drain(queue).map((action) => action.path)).toEqual(["c", "d", "e"]);
  });

  test("drops reads and never edits", () => {
    const queue = new ActionQueue();
    queue.push(edit("e1"));
    queue.push(read("r1"));
    queue.push(edit("e2"));
    queue.push(read("r2"));
    queue.push(edit("e3"));
    expect(drain(queue).map((action) => action.path)).toEqual(["e1", "e2", "e3"]);
  });

  test("lets edits pile up past the limit", () => {
    const queue = new ActionQueue();
    for (const path of ["a", "b", "c", "d", "e"]) queue.push(edit(path));
    expect(drain(queue)).toHaveLength(5);
  });
});

describe("ActionQueue merging edits", () => {
  test("folds a second edit of a waiting file into the first, keeping the first's before", () => {
    const queue = new ActionQueue();
    queue.push(edit("a", { before: "v1", after: "v2" }));
    queue.push(read("x"));
    queue.push(edit("a", { before: "v2", after: "v3" }));
    expect(drain(queue)).toEqual([edit("a", { before: "v1", after: "v3" }), read("x")]);
  });

  test("keeps edits of different files apart", () => {
    const queue = new ActionQueue();
    queue.push(edit("a"));
    queue.push(edit("b"));
    expect(queue.size).toBe(2);
  });

  test("keeps a created file created and settles only when every folded edit was typed out", () => {
    const queue = new ActionQueue();
    queue.push(edit("a", { before: null, after: "v1", settled: true }));
    queue.push(edit("a", { before: "v1", after: "v2", settled: false }));
    expect(drain(queue)).toEqual([edit("a", { before: null, after: "v2", settled: false })]);
  });

  test("a forced edit stays forced after merging", () => {
    const queue = new ActionQueue();
    queue.push(edit("a", { forced: true }));
    queue.push(edit("a", { after: "c" }));
    expect(drain(queue)[0]).toMatchObject({ forced: true, after: "c" });
  });

  test("does not count a merged edit towards the limit", () => {
    const queue = new ActionQueue();
    queue.push(read("r1"));
    queue.push(read("r2"));
    queue.push(edit("a"));
    queue.push(edit("a", { after: "c" }));
    expect(queue.size).toBe(3);
  });
});

describe("pauseAfterMs", () => {
  test.each([
    ["read", true, 380],
    ["read", false, 650],
    ["edit", true, 300],
    ["edit", false, 700],
  ] as const)("holds %s for %s queue => %i ms", (kind, moreQueued, ms) => {
    expect(pauseAfterMs(kind, moreQueued)).toBe(ms);
  });
});
