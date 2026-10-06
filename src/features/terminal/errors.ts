export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  return new Error(`Unexpected error value: ${JSON.stringify(value)}`);
}

export class PtyCommandError extends Error {
  readonly command: string;

  constructor(command: string, cause: unknown) {
    super(`${command} failed: ${toError(cause).message}`, { cause });
    this.name = "PtyCommandError";
    this.command = command;
  }
}
