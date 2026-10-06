import { describe, expect, test } from "bun:test";

import { FileChangeCapture } from "./file-capture";
import { createFakeFs } from "./testing/fake-fs";

const PATH = "/work/src/a.ts";

describe("FileChangeCapture", () => {
  test("captures the content before the tool runs and the content after it finishes", async () => {
    const fs = createFakeFs({ [PATH]: "const a = 1;\n" });
    const capture = new FileChangeCapture(fs.readText);

    await capture.begin("t1", PATH);
    fs.write(PATH, "const a = 2;\n");

    expect(await capture.finish("t1", false)).toEqual([
      { type: "file.change", toolUseId: "t1", path: PATH, kind: "update", before: "const a = 1;\n", after: "const a = 2;\n" },
    ]);
  });

  test("reports a file that did not exist before as a create with null before", async () => {
    const fs = createFakeFs();
    const capture = new FileChangeCapture(fs.readText);

    await capture.begin("t1", PATH);
    fs.write(PATH, "export {};\n");

    expect(await capture.finish("t1", false)).toEqual([
      { type: "file.change", toolUseId: "t1", path: PATH, kind: "create", before: null, after: "export {};\n" },
    ]);
  });

  test("does not read the file again when begin is called twice for the same tool use", async () => {
    const fs = createFakeFs({ [PATH]: "old" });
    const capture = new FileChangeCapture(fs.readText);

    await capture.begin("t1", PATH);
    fs.write(PATH, "new");
    await capture.begin("t1", PATH);

    const [event] = await capture.finish("t1", false);
    expect(event).toMatchObject({ before: "old", after: "new" });
  });

  test("keeps concurrent tool uses on the same file independent", async () => {
    const fs = createFakeFs({ [PATH]: "v0" });
    const capture = new FileChangeCapture(fs.readText);

    await capture.begin("t1", PATH);
    fs.write(PATH, "v1");
    await capture.begin("t2", PATH);
    fs.write(PATH, "v2");

    expect(await capture.finish("t1", false)).toMatchObject([{ before: "v0", after: "v2" }]);
    expect(await capture.finish("t2", false)).toMatchObject([{ before: "v1", after: "v2" }]);
  });

  test("emits nothing when the tool failed", async () => {
    const fs = createFakeFs({ [PATH]: "old" });
    const capture = new FileChangeCapture(fs.readText);

    await capture.begin("t1", PATH);
    fs.write(PATH, "partially written");

    expect(await capture.finish("t1", true)).toEqual([]);
  });

  test("emits nothing when the content did not change", async () => {
    const fs = createFakeFs({ [PATH]: "same" });
    const capture = new FileChangeCapture(fs.readText);

    await capture.begin("t1", PATH);

    expect(await capture.finish("t1", false)).toEqual([]);
  });

  test("emits nothing for tool uses it never saw begin", async () => {
    const capture = new FileChangeCapture(createFakeFs().readText);
    expect(await capture.finish("unknown", false)).toEqual([]);
  });

  test("forgets a tool use once it has finished", async () => {
    const fs = createFakeFs({ [PATH]: "a" });
    const capture = new FileChangeCapture(fs.readText);

    await capture.begin("t1", PATH);
    fs.write(PATH, "b");
    await capture.finish("t1", false);

    expect(await capture.finish("t1", false)).toEqual([]);
  });

  test("surfaces a failed before read as an error event instead of a wrong diff", async () => {
    const fs = createFakeFs({ [PATH]: "old" });
    fs.failReads(PATH, "permission denied");
    const capture = new FileChangeCapture(fs.readText);

    await capture.begin("t1", PATH);

    expect(await capture.finish("t1", false)).toEqual([
      { type: "error", message: `Could not capture ${PATH} before the change: permission denied` },
    ]);
  });

  test("surfaces a missing file after a successful tool as an error event", async () => {
    const fs = createFakeFs({ [PATH]: "old" });
    const capture = new FileChangeCapture(fs.readText);

    await capture.begin("t1", PATH);
    fs.remove(PATH);

    expect(await capture.finish("t1", false)).toEqual([
      { type: "error", message: `Could not capture ${PATH} after the change: the file does not exist` },
    ]);
  });

  test("clear drops pending captures", async () => {
    const fs = createFakeFs({ [PATH]: "a" });
    const capture = new FileChangeCapture(fs.readText);

    await capture.begin("t1", PATH);
    fs.write(PATH, "b");
    capture.clear();

    expect(await capture.finish("t1", false)).toEqual([]);
  });
});
