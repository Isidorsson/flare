import { describe, expect, test } from "bun:test";

import {
  FsCommandError,
  dirListingSchema,
  fileReadSchema,
  isNotFound,
  subscriptionIdSchema,
  toFsError,
  watchBatchSchema,
  type DirListing,
  type WatchBatch,
} from "./fs-schemas";

describe("dirListingSchema", () => {
  test("accepts what the Rust listing command returns", () => {
    const listing: DirListing = {
      entries: [
        { name: "src", path: "C:/p/src", kind: "dir" },
        { name: "a.ts", path: "C:/p/a.ts", kind: "file" },
      ],
      truncated: false,
    };
    expect(dirListingSchema.parse(listing)).toEqual(listing);
  });

  test("rejects unknown entry kinds and missing flags", () => {
    expect(dirListingSchema.safeParse({ entries: [{ name: "x", path: "x", kind: "link" }], truncated: false }).success).toBe(false);
    expect(dirListingSchema.safeParse({ entries: [] }).success).toBe(false);
  });
});

describe("fileReadSchema", () => {
  test("accepts text, binary and too-large reads", () => {
    expect(fileReadSchema.parse({ kind: "text", content: "hi", size: 2 })).toEqual({ kind: "text", content: "hi", size: 2 });
    expect(fileReadSchema.parse({ kind: "binary", size: 9 }).kind).toBe("binary");
    expect(fileReadSchema.parse({ kind: "tooLarge", size: 3_000_000, limit: 2_097_152 }).kind).toBe("tooLarge");
  });

  test("rejects text reads without content and unknown kinds", () => {
    expect(fileReadSchema.safeParse({ kind: "text", size: 2 }).success).toBe(false);
    expect(fileReadSchema.safeParse({ kind: "huge", size: 2 }).success).toBe(false);
  });
});

describe("watchBatchSchema", () => {
  test("accepts debounced batches", () => {
    const batch: WatchBatch = {
      root: "C:/p",
      changes: [
        { path: "C:/p/a.ts", kind: "modify" },
        { path: "C:/p/b.ts", kind: "remove" },
      ],
      rescan: false,
    };
    expect(watchBatchSchema.parse(batch)).toEqual(batch);
  });

  test("rejects the Rust-side kind name for deletions drifting", () => {
    const drifted = { root: "C:/p", changes: [{ path: "C:/p/a.ts", kind: "delete" }], rescan: false };
    expect(watchBatchSchema.safeParse(drifted).success).toBe(false);
  });
});

describe("subscriptionIdSchema", () => {
  test("accepts non-negative integers only", () => {
    expect(subscriptionIdSchema.parse(3)).toBe(3);
    expect(subscriptionIdSchema.safeParse(-1).success).toBe(false);
    expect(subscriptionIdSchema.safeParse("3").success).toBe(false);
  });
});

describe("toFsError", () => {
  test("turns the Rust error payload into a typed error", () => {
    const error = toFsError({ code: "not_found", message: "not found: C:/p/x" });
    expect(error).toBeInstanceOf(FsCommandError);
    expect(error.message).toBe("not found: C:/p/x");
    expect(isNotFound(error)).toBe(true);
  });

  test("passes real errors through and wraps everything else", () => {
    const original = new TypeError("boom");
    expect(toFsError(original)).toBe(original);
    expect(toFsError("plain").message).toBe("plain");
    expect(toFsError({ unexpected: true }).message).toBe('{"unexpected":true}');
    expect(isNotFound(toFsError({ code: "io", message: "x" }))).toBe(false);
  });
});
