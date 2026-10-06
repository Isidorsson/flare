import { beforeEach, describe, expect, test } from "bun:test";

import { createFrameLoop, HEARTBEAT_MS, MIN_FRAME_INTERVAL_MS, type FrameScheduler } from "./frame-loop";

interface FakeClock {
  scheduler: FrameScheduler;
  advance: (ms: number) => void;
  pendingFrames: () => number;
  pendingTimers: () => number;
}

function createFakeClock(): FakeClock {
  let time = 0;
  let nextHandle = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { at: number; callback: () => void }>();

  const runFrames = () => {
    const due = [...frames.entries()];
    frames.clear();
    for (const [, callback] of due) callback();
  };

  const runTimers = () => {
    for (const [handle, timer] of [...timers.entries()]) {
      if (timer.at > time) continue;
      timers.delete(handle);
      timer.callback();
    }
  };

  const scheduler: FrameScheduler = {
    requestFrame: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      frames.delete(handle);
    },
    setTimer: (callback, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { at: time + ms, callback });
      return handle;
    },
    clearTimer: (handle) => {
      timers.delete(handle);
    },
    now: () => time,
  };

  return {
    scheduler,
    advance: (ms) => {
      time += ms;
      runTimers();
      runFrames();
    },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
  };
}

let clock: FakeClock;

beforeEach(() => {
  clock = createFakeClock();
});

describe("frame loop", () => {
  test("does nothing until woken", () => {
    createFrameLoop({ scheduler: clock.scheduler, step: () => false, heartbeat: () => false });
    expect(clock.pendingFrames()).toBe(0);
    expect(clock.pendingTimers()).toBe(0);
  });

  test("keeps stepping while the step asks for more, then stops", () => {
    let remaining = 3;
    const deltas: number[] = [];
    const loop = createFrameLoop({
      scheduler: clock.scheduler,
      step: (delta) => {
        deltas.push(delta);
        remaining -= 1;
        return remaining > 0;
      },
      heartbeat: () => false,
    });
    loop.wake();
    for (let frame = 0; frame < 10; frame += 1) clock.advance(MIN_FRAME_INTERVAL_MS);
    expect(deltas).toHaveLength(3);
    expect(clock.pendingFrames()).toBe(0);
  });

  test("caps the step rate by skipping frames that come too soon", () => {
    let steps = 0;
    const loop = createFrameLoop({
      scheduler: clock.scheduler,
      step: () => {
        steps += 1;
        return true;
      },
      heartbeat: () => false,
    });
    loop.wake();
    clock.advance(1);
    for (let elapsed = 0; elapsed < 1000; elapsed += 5) clock.advance(5);
    expect(steps).toBeLessThanOrEqual(Math.ceil(1000 / MIN_FRAME_INTERVAL_MS) + 1);
    expect(steps).toBeGreaterThan(30);
    loop.dispose();
  });

  test("hands the step the time since the previous step, clamped after a long stall", () => {
    const deltas: number[] = [];
    const loop = createFrameLoop({
      scheduler: clock.scheduler,
      step: (delta) => {
        deltas.push(delta);
        return deltas.length < 3;
      },
      heartbeat: () => false,
    });
    loop.wake();
    clock.advance(30);
    clock.advance(30);
    clock.advance(5000);
    expect(deltas[1]).toBe(30);
    expect(deltas[2]).toBe(100);
  });

  test("runs a slow heartbeat once idle for as long as it returns true", () => {
    let beats = 0;
    const loop = createFrameLoop({
      scheduler: clock.scheduler,
      step: () => false,
      heartbeat: () => {
        beats += 1;
        return beats < 3;
      },
    });
    loop.wake();
    clock.advance(16);
    expect(beats).toBe(0);
    for (let tick = 0; tick < 5; tick += 1) clock.advance(HEARTBEAT_MS);
    expect(beats).toBe(3);
    expect(clock.pendingTimers()).toBe(0);
  });

  test("waking cancels the pending heartbeat and resumes frames", () => {
    let steps = 0;
    const loop = createFrameLoop({
      scheduler: clock.scheduler,
      step: () => {
        steps += 1;
        return false;
      },
      heartbeat: () => true,
    });
    loop.wake();
    clock.advance(16);
    expect(clock.pendingTimers()).toBe(1);
    loop.wake();
    expect(clock.pendingTimers()).toBe(0);
    expect(clock.pendingFrames()).toBe(1);
    clock.advance(16);
    expect(steps).toBe(2);
  });

  test("waking twice before a frame schedules only one frame", () => {
    const loop = createFrameLoop({ scheduler: clock.scheduler, step: () => false, heartbeat: () => false });
    loop.wake();
    loop.wake();
    expect(clock.pendingFrames()).toBe(1);
  });

  test("dispose cancels frames and timers and ignores later wakes", () => {
    let steps = 0;
    const loop = createFrameLoop({
      scheduler: clock.scheduler,
      step: () => {
        steps += 1;
        return false;
      },
      heartbeat: () => true,
    });
    loop.wake();
    clock.advance(16);
    loop.dispose();
    expect(clock.pendingTimers()).toBe(0);
    loop.wake();
    clock.advance(1000);
    expect(steps).toBe(1);
    expect(clock.pendingFrames()).toBe(0);
  });
});
