import type { ChatItem } from "@/features/agent/thread-types";

import { TurnFooter } from "./TurnFooter";
import { turnAnchorAt } from "./turn-anchor";

interface TurnEndProps {
  threadId: string;
  items: readonly ChatItem[];
  /** The transcript row this renders after. */
  index: number;
}

/** Rendered after every transcript row; shows the undo footer after the last row of a turn. */
export function TurnEnd({ threadId, items, index }: TurnEndProps) {
  const anchorItemId = turnAnchorAt(items, index);
  return anchorItemId === null ? null : <TurnFooter threadId={threadId} anchorItemId={anchorItemId} />;
}
