/** Wait this long after the last change before reading git's status again. */
export const REFRESH_QUIET_MS = 400;
/** A steady stream of changes (an agent writing files) must not postpone the refresh for longer than this. */
export const REFRESH_MAX_WAIT_MS = 2000;

export interface Timers {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

export interface RefreshScheduler {
  /** Asks for a refresh; calls close together are folded into one. */
  request: () => void;
  cancel: () => void;
}

export function createRefreshScheduler(run: () => void, timers: Timers): RefreshScheduler {
  let handle: number | null = null;
  let firstRequestAt = 0;

  const cancel = () => {
    if (handle === null) return;
    timers.clearTimeout(handle);
    handle = null;
  };

  const request = () => {
    const now = timers.now();
    if (handle === null) firstRequestAt = now;
    else timers.clearTimeout(handle);
    const wait = Math.min(REFRESH_QUIET_MS, Math.max(0, firstRequestAt + REFRESH_MAX_WAIT_MS - now));
    handle = timers.setTimeout(() => {
      handle = null;
      run();
    }, wait);
  };

  return { request, cancel };
}
