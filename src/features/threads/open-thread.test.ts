import { describe, expect, test } from "bun:test";

import { createThread } from "@/features/agent/thread-types";

import { openThread } from "./open-thread";

const thread = createThread({ id: "t1", cwd: "C:/work/app", createdAt: 1 });

function recorder(currentRoot: string | null) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      currentRoot,
      setRoot: (root: string) => calls.push(`root:${root}`),
      selectThread: (id: string) => calls.push(`select:${id}`),
    },
  };
}

describe("openThread", () => {
  test("moves the workspace to the thread's folder before selecting it", () => {
    const { calls, deps } = recorder("C:/work/other");
    openThread(thread, deps);
    expect(calls).toEqual(["root:C:/work/app", "select:t1"]);
  });

  test("moves the workspace when no folder is open", () => {
    const { calls, deps } = recorder(null);
    openThread(thread, deps);
    expect(calls).toEqual(["root:C:/work/app", "select:t1"]);
  });

  test("leaves the workspace alone when the thread is already in the open folder", () => {
    const { calls, deps } = recorder("C:/work/app");
    openThread(thread, deps);
    expect(calls).toEqual(["select:t1"]);
  });
});
