import type { Scheduler } from "./player";

interface Timer {
  id: number;
  at: number;
  callback: () => void;
}

export interface FakeScheduler extends Scheduler {
  now: () => number;
  // Moves time forward, running every timer that comes due on the way, in order.
  advance: (ms: number) => void;
  pending: () => number;
}

export function createFakeScheduler(): FakeScheduler {
  let now = 0;
  let nextId = 1;
  let timers: Timer[] = [];
  return {
    now: () => now,
    pending: () => timers.length,
    setTimeout: (callback, ms) => {
      const id = nextId;
      nextId += 1;
      timers.push({ id, at: now + ms, callback });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((timer) => timer.id !== id);
    },
    advance: (ms) => {
      const target = now + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (due === undefined) break;
        timers = timers.filter((timer) => timer.id !== due.id);
        now = due.at;
        due.callback();
      }
      now = target;
    },
  };
}
