import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_SNAPSHOT_BYTES, readTextFile } from "./read-text-file";
import { rejectionOf } from "./testing/async-helpers";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "flare-read-text-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readTextFile", () => {
  test("reads a utf8 file", async () => {
    const path = join(dir, "a.txt");
    await writeFile(path, "héllo\n", "utf8");
    expect(await readTextFile(path)).toBe("héllo\n");
  });

  test("returns null for a missing file", async () => {
    expect(await readTextFile(join(dir, "missing.txt"))).toBeNull();
  });

  test("throws for a file above the snapshot limit", async () => {
    const path = join(dir, "big.txt");
    await writeFile(path, Buffer.alloc(MAX_SNAPSHOT_BYTES + 1, "a"));
    expect((await rejectionOf(readTextFile(path))).message).toContain("diff limit");
  });

  test("throws for errors other than a missing file", async () => {
    expect(await rejectionOf(readTextFile(dir))).toBeInstanceOf(Error);
  });
});
