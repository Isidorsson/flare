import { describe, expect, test } from "bun:test";

import { createSerialRunner } from "./serial-runner";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("serial runner", () => {
  test("runs tasks in submission order even when earlier ones are slower", async () => {
    const log: string[] = [];
    const run = createSerialRunner(() => undefined);

    run(async () => {
      await sleep(15);
      log.push("slow");
    });
    run(() => {
      log.push("fast");
      return Promise.resolve();
    });
    await sleep(40);

    expect(log).toEqual(["slow", "fast"]);
  });

  test("never overlaps two tasks", async () => {
    let running = 0;
    let peak = 0;
    const run = createSerialRunner(() => undefined);
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(5);
      running -= 1;
    };

    for (let i = 0; i < 4; i += 1) run(task);
    await sleep(50);

    expect(peak).toBe(1);
  });

  test("reports a failure and carries on with the next task", async () => {
    const errors: unknown[] = [];
    const log: string[] = [];
    const run = createSerialRunner((error) => errors.push(error));
    const failure = new Error("boom");

    run(() => Promise.reject(failure));
    run(() => {
      log.push("after");
      return Promise.resolve();
    });
    await sleep(10);

    expect(errors).toEqual([failure]);
    expect(log).toEqual(["after"]);
  });
});
