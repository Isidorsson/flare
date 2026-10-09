import { describe, expect, test } from "bun:test";

import { createFakeScheduler } from "@/features/files/live/fake-scheduler";

import { REFRESH_MAX_WAIT_MS, REFRESH_QUIET_MS, createRefreshScheduler } from "./refresh-scheduler";

function setup() {
  const clock = createFakeScheduler();
  let runs = 0;
  const scheduler = createRefreshScheduler(() => {
    runs += 1;
  }, clock);
  return { clock, scheduler, runs: () => runs };
}

describe("createRefreshScheduler", () => {
  test("refreshes once after things go quiet", () => {
    const { clock, scheduler, runs } = setup();
    scheduler.request();
    clock.advance(REFRESH_QUIET_MS - 1);
    expect(runs()).toBe(0);
    clock.advance(1);
    expect(runs()).toBe(1);
  });

  test("folds a burst of requests into one refresh after the last of them", () => {
    const { clock, scheduler, runs } = setup();
    for (let index = 0; index < 5; index += 1) {
      scheduler.request();
      clock.advance(REFRESH_QUIET_MS / 2);
    }
    expect(runs()).toBe(0);
    clock.advance(REFRESH_QUIET_MS);
    expect(runs()).toBe(1);
  });

  test("a stream that never goes quiet still refreshes within the maximum wait", () => {
    const { clock, scheduler, runs } = setup();
    const step = REFRESH_QUIET_MS / 2;
    for (let elapsed = 0; elapsed < REFRESH_MAX_WAIT_MS; elapsed += step) {
      scheduler.request();
      clock.advance(step);
    }
    expect(runs()).toBe(1);
  });

  test("starts a fresh wait for a request after a refresh ran", () => {
    const { clock, scheduler, runs } = setup();
    scheduler.request();
    clock.advance(REFRESH_QUIET_MS);
    scheduler.request();
    clock.advance(REFRESH_QUIET_MS - 1);
    expect(runs()).toBe(1);
    clock.advance(1);
    expect(runs()).toBe(2);
  });

  test("cancel drops the pending refresh and does nothing when none is pending", () => {
    const { clock, scheduler, runs } = setup();
    scheduler.cancel();
    scheduler.request();
    scheduler.cancel();
    clock.advance(REFRESH_MAX_WAIT_MS);
    expect(runs()).toBe(0);
    expect(clock.pending()).toBe(0);
  });
});
