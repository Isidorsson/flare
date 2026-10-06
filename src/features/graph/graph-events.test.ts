import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { GRAPH_CHANGED_EVENT, subscribeToGraphChanges, type Listen } from "./graph-events";

let consoleError: ReturnType<typeof spyOn<Console, "error">>;

beforeEach(() => {
  consoleError = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

function controllableListen() {
  const handlers: (() => void)[] = [];
  let unlistened = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const listen: Listen = async (event, handler) => {
    expect(event).toBe(GRAPH_CHANGED_EVENT);
    await gate;
    handlers.push(handler);
    return () => {
      unlistened += 1;
    };
  };
  return { listen, handlers, release, unlistened: () => unlistened };
}

describe("subscribeToGraphChanges", () => {
  test("invokes the handler for each event once subscribed", async () => {
    const control = controllableListen();
    let changes = 0;
    subscribeToGraphChanges(() => {
      changes += 1;
    }, control.listen);
    control.release();
    await Promise.resolve();
    await Promise.resolve();
    control.handlers.forEach((handler) => {
      handler();
      handler();
    });
    expect(changes).toBe(2);
  });

  test("cancelling after the subscription is live unlistens exactly once", async () => {
    const control = controllableListen();
    const subscription = subscribeToGraphChanges(() => undefined, control.listen);
    control.release();
    await Promise.resolve();
    await Promise.resolve();
    subscription.cancel();
    subscription.cancel();
    expect(control.unlistened()).toBe(1);
  });

  test("cancelling before the subscription resolves unlistens as soon as it does", async () => {
    const control = controllableListen();
    const subscription = subscribeToGraphChanges(() => undefined, control.listen);
    subscription.cancel();
    expect(control.unlistened()).toBe(0);
    control.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(control.unlistened()).toBe(1);
  });

  test("reports a failed subscription instead of swallowing it", async () => {
    const failing: Listen = () => Promise.reject(new Error("no tauri"));
    const subscription = subscribeToGraphChanges(() => undefined, failing);
    await Promise.resolve();
    await Promise.resolve();
    subscription.cancel();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
