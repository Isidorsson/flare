import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { bunTargetFor, parseHostTriple, sidecarFileName } from "./targets";

const ROOT = resolve(import.meta.dir, "..", "..");
const ENTRY = join(ROOT, "bridge", "src", "main.ts");
const OUT_DIR = join(ROOT, "src-tauri", "binaries");

async function run(command: string[]): Promise<string> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "inherit" });
  const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} exited with code ${code}`);
  return output;
}

async function main(): Promise<void> {
  const host = parseHostTriple(await run(["rustc", "-vV"]));
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? host;
  const outfile = join(OUT_DIR, sidecarFileName(triple));
  const crossTarget = triple === host ? [] : [`--target=${bunTargetFor(triple)}`];

  await mkdir(OUT_DIR, { recursive: true });
  // A sidecar that autoloads .env or bunfig.toml would read files from whatever project the user opens.
  const output = await run([
    process.execPath,
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    ...crossTarget,
    `--outfile=${outfile}`,
    ENTRY,
  ]);
  process.stdout.write(`${output}Built ${outfile}\n`);
}

await main();
