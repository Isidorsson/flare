import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { debounce } from "./debounce";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("debounce", () => {
  test("runs once, after the delay, with the trailing call", () => {
    let runs = 0;
    const debounced = debounce(() => {
      runs += 1;
    }, 100);

    debounced.call();
    jest.advanceTimersByTime(60);
    debounced.call();
    jest.advanceTimersByTime(60);
    expect(runs).toBe(0);

    jest.advanceTimersByTime(40);
    expect(runs).toBe(1);
  });

  test("can run again after it fired", () => {
    let runs = 0;
    const debounced = debounce(() => {
      runs += 1;
    }, 50);

    debounced.call();
    jest.advanceTimersByTime(50);
    debounced.call();
    jest.advanceTimersByTime(50);

    expect(runs).toBe(2);
  });

  test("cancel drops the pending run", () => {
    let runs = 0;
    const debounced = debounce(() => {
      runs += 1;
    }, 50);

    debounced.call();
    debounced.cancel();
    jest.advanceTimersByTime(200);

    expect(runs).toBe(0);
  });

  test("cancel without a pending run is harmless", () => {
    const debounced = debounce(() => undefined, 50);
    expect(() => {
      debounced.cancel();
    }).not.toThrow();
  });
});
