import { describe, expect, test } from "bun:test";

import { AsyncQueue } from "./queue";

describe("AsyncQueue", () => {
  test("yields items pushed before iteration in order", async () => {
    const queue = new AsyncQueue<{ n: number }>();
    queue.push({ n: 1 });
    queue.push({ n: 2 });
    queue.close();

    const seen: number[] = [];
    for await (const item of queue) seen.push(item.n);
    expect(seen).toEqual([1, 2]);
  });

  test("wakes a waiting consumer when an item is pushed", async () => {
    const queue = new AsyncQueue<{ n: number }>();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();

    queue.push({ n: 7 });

    expect(await pending).toEqual({ done: false, value: { n: 7 } });
  });

  test("close ends a waiting consumer", async () => {
    const queue = new AsyncQueue<{ n: number }>();
    const pending = queue[Symbol.asyncIterator]().next();

    queue.close();

    expect((await pending).done).toBe(true);
  });

  test("drains queued items before reporting done", async () => {
    const queue = new AsyncQueue<{ n: number }>();
    queue.push({ n: 1 });
    queue.close();
    const iterator = queue[Symbol.asyncIterator]();

    expect(await iterator.next()).toEqual({ done: false, value: { n: 1 } });
    expect((await iterator.next()).done).toBe(true);
  });

  test("rejects pushes after close", () => {
    const queue = new AsyncQueue<{ n: number }>();
    queue.close();
    expect(() => {
      queue.push({ n: 1 });
    }).toThrow("closed");
    expect(queue.closed).toBe(true);
  });

  test("breaking out of a for-await loop closes the queue", async () => {
    const queue = new AsyncQueue<{ n: number }>();
    queue.push({ n: 1 });
    for await (const item of queue) {
      expect(item.n).toBe(1);
      break;
    }
    expect(queue.closed).toBe(true);
  });
});
