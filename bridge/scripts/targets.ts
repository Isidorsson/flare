export const SIDECAR_NAME = "flare-bridge";

const BUN_TARGETS: Readonly<Record<string, string>> = {
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "aarch64-pc-windows-msvc": "bun-windows-arm64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-apple-darwin": "bun-darwin-arm64",
};

export function bunTargetFor(triple: string): string {
  const target = BUN_TARGETS[triple];
  if (target === undefined) throw new Error(`No Bun compile target for Rust target ${triple}`);
  return target;
}

export function sidecarFileName(triple: string): string {
  const extension = triple.includes("windows") ? ".exe" : "";
  return `${SIDECAR_NAME}-${triple}${extension}`;
}

export function parseHostTriple(rustcVersionOutput: string): string {
  const match = /^host: (\S+)$/m.exec(rustcVersionOutput);
  const triple = match?.[1];
  if (triple === undefined) throw new Error("Could not find the host triple in `rustc -vV` output");
  return triple;
}
