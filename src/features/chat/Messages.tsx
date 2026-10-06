import { CircleAlert } from "lucide-react";
import { memo } from "react";

import { Markdown } from "./markdown/Markdown";

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-lg bg-surface-3 px-3 py-2 text-sm break-words whitespace-pre-wrap text-fg select-text">
        {text}
      </p>
    </div>
  );
}

export const AssistantMessage = memo(function AssistantMessage({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="text-sm leading-relaxed text-fg select-text">
      <Markdown text={text} streaming={streaming} />
    </div>
  );
});

export function NoticeRow({ text }: { text: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-danger/40 bg-surface-1 px-3 py-2 text-xs text-fg select-text"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
      <p className="min-w-0 break-words whitespace-pre-wrap">{text}</p>
    </div>
  );
}
