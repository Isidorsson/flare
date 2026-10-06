export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return stringify(error) ?? String(error);
}

function stringify(value: unknown): string | undefined {
  return JSON.stringify(value);
}
