import type { ChatItem } from "@/features/agent/thread-types";

/**
 * For the transcript row at `index`: the user message that opened its turn when this row is the
 * turn's last one (the next row starts a new turn or there is none), otherwise null.
 */
export function turnAnchorAt(items: readonly ChatItem[], index: number): string | null {
  const next = items[index + 1];
  if (next !== undefined && next.kind !== "user") return null;
  for (let at = index; at >= 0; at -= 1) {
    const item = items[at];
    if (item?.kind === "user") return item.id;
  }
  return null;
}
