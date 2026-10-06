export const MIN_FRAME_INTERVAL_MS = 25;
export const MAX_FRAME_DELTA_MS = 100;
export const HEARTBEAT_MS = 5000;
const FIRST_FRAME_DELTA_MS = 1000 / 60;

export interface FrameScheduler {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  setTimer: (callback: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
  now: () => number;
}

export const browserFrameScheduler: FrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => {
    cancelAnimationFrame(handle);
  },
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (handle) => {
    window.clearTimeout(handle);
  },
  now: () => performance.now(),
};

export interface FrameLoopOptions {
  scheduler: FrameScheduler;
  /** Runs once per frame while animating; returns whether another frame is needed. */
  step: (deltaMs: number) => boolean;
  /** Runs on the slow timer once animation stops; returns whether it should keep ticking. */
  heartbeat: () => boolean;
}

export interface FrameLoop {
  wake: () => void;
  dispose: () => void;
}

export function createFrameLoop(options: FrameLoopOptions): FrameLoop {
  const { scheduler } = options;
  let frame: number | null = null;
  let timer: number | null = null;
  let lastStepAt: number | null = null;
  let disposed = false;

  const cancelTimer = () => {
    if (timer !== null) scheduler.clearTimer(timer);
    timer = null;
  };

  const scheduleHeartbeat = () => {
    timer = scheduler.setTimer(() => {
      timer = null;
      if (options.heartbeat()) scheduleHeartbeat();
    }, HEARTBEAT_MS);
  };

  const onFrame = () => {
    frame = null;
    if (disposed) return;
    const now = scheduler.now();
    if (lastStepAt !== null && now - lastStepAt < MIN_FRAME_INTERVAL_MS) {
      frame = scheduler.requestFrame(onFrame);
      return;
    }
    const delta = lastStepAt === null ? FIRST_FRAME_DELTA_MS : Math.min(now - lastStepAt, MAX_FRAME_DELTA_MS);
    lastStepAt = now;
    if (options.step(delta)) {
      frame = scheduler.requestFrame(onFrame);
      return;
    }
    lastStepAt = null;
    scheduleHeartbeat();
  };

  return {
    wake: () => {
      if (disposed || frame !== null) return;
      cancelTimer();
      frame = scheduler.requestFrame(onFrame);
    },
    dispose: () => {
      disposed = true;
      if (frame !== null) scheduler.cancelFrame(frame);
      frame = null;
      cancelTimer();
    },
  };
}
