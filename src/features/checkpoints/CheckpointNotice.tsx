import { CircleAlert, History, X } from "lucide-react";

import { ChatButton } from "@/features/chat/ChatButton";
import { IconButton } from "@/shared/ui/IconButton";
import { Tooltip } from "@/shared/ui/Tooltip";

import { useCheckpoints } from "./use-checkpoints";

/** Says what an undo did and offers to take it back; also reports snapshots that could not be taken. */
export function CheckpointNotice() {
  const notice = useCheckpoints((state) => state.notice);
  const restoring = useCheckpoints((state) => state.restoring);
  const runNoticeAction = useCheckpoints((state) => state.runNoticeAction);
  const dismissNotice = useCheckpoints((state) => state.dismissNotice);
  if (notice === null) return null;

  const failed = notice.tone === "error";
  const Icon = failed ? CircleAlert : History;
  return (
    <div className="shrink-0 px-4 pb-2">
      <div
        role={failed ? "alert" : "status"}
        className={`mx-auto flex w-full max-w-3xl items-start gap-2 rounded-lg border bg-surface-2 py-2 pr-2 pl-3 text-xs text-fg select-text ${
          failed ? "border-danger/40" : "border-border-strong"
        }`}
      >
        <Icon aria-hidden className={`mt-1 size-3.5 shrink-0 ${failed ? "text-danger" : "text-accent"}`} />
        <div className="min-w-0 flex-1 self-center">
          <p className="break-words">{notice.message}</p>
          {notice.detail !== null && <p className="mt-1 break-words whitespace-pre-wrap text-fg-subtle">{notice.detail}</p>}
        </div>
        {notice.action !== null && (
          <Tooltip content={notice.action.hint} side="top">
            <ChatButton disabled={restoring} onClick={runNoticeAction}>
              {notice.action.label}
            </ChatButton>
          </Tooltip>
        )}
        <IconButton icon={X} label="Dismiss" side="top" onClick={dismissNotice} />
      </div>
    </div>
  );
}
