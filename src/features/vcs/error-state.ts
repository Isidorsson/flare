import type { VcsAction, VcsSnapshot } from "./vcs-types";

type Errors = VcsSnapshot["errors"];

export function withoutError(errors: Errors, action: VcsAction): Errors {
  return Object.fromEntries(Object.entries(errors).filter(([name]) => name !== action));
}

export function withError(errors: Errors, action: VcsAction, message: string): Errors {
  return { ...errors, [action]: message };
}
