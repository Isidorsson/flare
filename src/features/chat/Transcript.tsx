import { MessageSquare } from "lucide-react";

import type { ChatItem, Thread } from "@/features/agent/thread-types";
import { useAgent } from "@/features/agent/use-agent";
import { EmptyState } from "@/shared/ui/EmptyState";
import type { PermissionDecision } from "@flare/protocol";

import { MarkdownServicesContext } from "./markdown/services";
import { AssistantMessage, NoticeRow, UserMessage } from "./Messages";
import { PermissionCard } from "./PermissionCard";
import { ToolCard } from "./ToolCard";
import { useChatMarkdownServices } from "./use-chat-markdown-services";
import { useStickToBottom } from "./use-stick-to-bottom";

interface ItemRowProps {
  item: ChatItem;
  onRespond: (requestId: string, decision: PermissionDecision) => void;
}

function ItemRow({ item, onRespond }: ItemRowProps) {
  switch (item.kind) {
    case "user":
      return <UserMessage text={item.text} />;
    case "assistant":
      return <AssistantMessage text={item.text} streaming={item.streaming} />;
    case "tool":
      return <ToolCard item={item} />;
    case "permission":
      return <PermissionCard item={item} onRespond={onRespond} />;
    case "notice":
      return <NoticeRow text={item.text} />;
  }
}

export function Transcript({ thread }: { thread: Thread | null }) {
  const respondToPermission = useAgent((state) => state.respondToPermission);
  const markdownServices = useChatMarkdownServices();
  const { ref, onScroll } = useStickToBottom<HTMLDivElement>(thread?.items);

  if (!thread || thread.items.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          icon={MessageSquare}
          title="Start a conversation"
          description="Ask Claude to read, explain or change your project. Replies, tool calls and approvals stream in here."
        />
      </div>
    );
  }

  return (
    <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <MarkdownServicesContext value={markdownServices}>
        <div role="log" aria-live="polite" className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
          {thread.items.map((item) => (
            <ItemRow key={item.id} item={item} onRespond={respondToPermission} />
          ))}
        </div>
      </MarkdownServicesContext>
    </div>
  );
}
