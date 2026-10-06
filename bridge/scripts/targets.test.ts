import { describe, expect, test } from "bun:test";

import { bunTargetFor, parseHostTriple, SIDECAR_NAME, sidecarFileName } from "./targets";

describe("sidecarFileName", () => {
  test("appends the target triple and .exe on Windows as Tauri's externalBin convention requires", () => {
    expect(sidecarFileName("x86_64-pc-windows-msvc")).toBe(`${SIDECAR_NAME}-x86_64-pc-windows-msvc.exe`);
  });

  test("has no extension elsewhere", () => {
    expect(sidecarFileName("aarch64-apple-darwin")).toBe(`${SIDECAR_NAME}-aarch64-apple-darwin`);
    expect(sidecarFileName("x86_64-unknown-linux-gnu")).toBe(`${SIDECAR_NAME}-x86_64-unknown-linux-gnu`);
  });
});

describe("bunTargetFor", () => {
  test.each([
    ["x86_64-pc-windows-msvc", "bun-windows-x64"],
    ["aarch64-pc-windows-msvc", "bun-windows-arm64"],
    ["x86_64-unknown-linux-gnu", "bun-linux-x64"],
    ["aarch64-unknown-linux-gnu", "bun-linux-arm64"],
    ["x86_64-apple-darwin", "bun-darwin-x64"],
    ["aarch64-apple-darwin", "bun-darwin-arm64"],
  ])("maps %s to %s", (triple, target) => {
    expect(bunTargetFor(triple)).toBe(target);
  });

  test("fails for a triple Bun cannot compile for", () => {
    expect(() => bunTargetFor("riscv64gc-unknown-linux-gnu")).toThrow("riscv64gc-unknown-linux-gnu");
  });
});

describe("parseHostTriple", () => {
  test("reads the host line of rustc -vV", () => {
    const output = "rustc 1.93.0\nbinary: rustc\nhost: x86_64-pc-windows-msvc\nrelease: 1.93.0\n";
    expect(parseHostTriple(output)).toBe("x86_64-pc-windows-msvc");
  });

  test("fails when there is no host line", () => {
    expect(() => parseHostTriple("rustc 1.93.0\n")).toThrow("host triple");
  });
});
