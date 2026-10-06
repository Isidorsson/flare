import { describe, expect, test } from "bun:test";

import { createGraphApi, type Invoke } from "./graph-api";

interface Call {
  command: string;
  args: Record<string, unknown> | undefined;
}

function fakeInvoke(response: unknown): { invoke: Invoke; calls: Call[] } {
  const calls: Call[] = [];
  const invoke: Invoke = (command, args) => {
    calls.push({ command, args });
    return Promise.resolve(response);
  };
  return { invoke, calls };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

const validSnapshot = {
  root: "C:/app",
  nodes: [{ id: "src/a.ts", language: "typescript" }],
  edges: [],
  warnings: [],
};

describe("graph api", () => {
  test("build passes the root to graph_build and returns the parsed snapshot", async () => {
    const { invoke, calls } = fakeInvoke(validSnapshot);
    const snapshot = await createGraphApi(invoke).build("C:\\app");
    expect(calls).toEqual([{ command: "graph_build", args: { root: "C:\\app" } }]);
    expect(snapshot.nodes[0]?.id).toBe("src/a.ts");
  });

  test("snapshot takes no arguments", async () => {
    const { invoke, calls } = fakeInvoke(validSnapshot);
    await createGraphApi(invoke).snapshot();
    expect(calls).toEqual([{ command: "graph_snapshot", args: undefined }]);
  });

  test("blastRadius sends the path and parses dependents", async () => {
    const { invoke, calls } = fakeInvoke({ origin: "src/a.ts", nodes: [{ id: "src/b.ts", depth: 2 }] });
    const radius = await createGraphApi(invoke).blastRadius("src/a.ts");
    expect(calls).toEqual([{ command: "graph_blast_radius", args: { path: "src/a.ts" } }]);
    expect(radius.nodes).toEqual([{ id: "src/b.ts", depth: 2 }]);
  });

  test("updateFile and removeFile return the change kind", async () => {
    const updated = fakeInvoke("updated");
    expect(await createGraphApi(updated.invoke).updateFile("src/a.ts")).toBe("updated");
    expect(updated.calls[0]?.command).toBe("graph_update_file");
    const removed = fakeInvoke("removed");
    expect(await createGraphApi(removed.invoke).removeFile("src/a.ts")).toBe("removed");
    expect(removed.calls[0]?.command).toBe("graph_remove_file");
  });

  test("rejects a snapshot that does not match the schema instead of trusting it", async () => {
    const { invoke } = fakeInvoke({ root: "C:/app", nodes: [{ id: "a.cob", language: "cobol" }], edges: [], warnings: [] });
    expect(await rejection(createGraphApi(invoke).build("C:/app"))).toBeInstanceOf(Error);
  });

  test("rejects an unknown change kind", async () => {
    const { invoke } = fakeInvoke("exploded");
    expect(await rejection(createGraphApi(invoke).updateFile("a.ts"))).toBeInstanceOf(Error);
  });

  test("propagates command failures from Rust", async () => {
    const failing: Invoke = () => Promise.reject(new Error("cannot index workspace root X"));
    const error = await rejection(createGraphApi(failing).build("X"));
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : "").toBe("cannot index workspace root X");
  });
});
