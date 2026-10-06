import { readFile, stat } from "node:fs/promises";

export const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

export async function readTextFile(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (info.size > MAX_SNAPSHOT_BYTES) {
      throw new Error(`file is ${info.size} bytes, above the ${MAX_SNAPSHOT_BYTES} byte diff limit`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
