import type { PermissionDecision } from "@flare/protocol";
import { ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";

import type { PermissionItem, PermissionStatus } from "@/features/agent/thread-types";

import { ChatButton } from "./ChatButton";
import { formatToolInput, primaryInputText } from "./tool-preview";

type ResolvedStatus = Exclude<PermissionStatus, "pending">;

const RESOLVED_LABELS: Record<ResolvedStatus, string> = {
  allow: "Allowed",
  allowSession: "Allowed for this session",
  deny: "Denied",
  expired: "No longer needed",
};

const RESOLVED_TONES: Record<ResolvedStatus, string> = {
  allow: "text-success",
  allowSession: "text-success",
  deny: "text-danger",
  expired: "text-fg-subtle",
};

type Respond = (requestId: string, decision: PermissionDecision) => void;

function Decision({ status }: { status: ResolvedStatus }) {
  const Icon = status === "deny" ? ShieldX : ShieldCheck;
  return (
    <p className={`flex items-center gap-1.5 text-xs ${RESOLVED_TONES[status]}`}>
      <Icon aria-hidden className="size-3.5" />
      {RESOLVED_LABELS[status]}
    </p>
  );
}

function Actions({ requestId, onRespond }: { requestId: string; onRespond: Respond }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ChatButton
        variant="primary"
        onClick={() => {
          onRespond(requestId, "allow");
        }}
      >
        Allow
      </ChatButton>
      <ChatButton
        onClick={() => {
          onRespond(requestId, "allowSession");
        }}
      >
        Allow for session
      </ChatButton>
      <ChatButton
        variant="danger"
        onClick={() => {
          onRespond(requestId, "deny");
        }}
      >
        Deny
      </ChatButton>
    </div>
  );
}

export function PermissionCard({ item, onRespond }: { item: PermissionItem; onRespond: Respond }) {
  const detail = primaryInputText(item.input) ?? formatToolInput(item.input);
  const pending = item.status === "pending";

  return (
    <section
      aria-label={`Permission request for ${item.toolName}`}
      className={`space-y-3 rounded-lg border bg-surface-1 p-3 ${pending ? "border-warning/50" : "border-border"}`}
    >
      <header className="flex items-center gap-2 text-sm">
        <ShieldQuestion aria-hidden className={`size-4 shrink-0 ${pending ? "text-warning" : "text-fg-subtle"}`} />
        <span>
          Claude wants to use <strong className="font-semibold">{item.toolName}</strong>
        </span>
      </header>
      <pre className="max-h-40 overflow-auto rounded-md bg-bg p-2 font-mono text-[11px] whitespace-pre-wrap text-fg-muted select-text">
        {detail}
      </pre>
      {item.status === "pending" ? (
        <Actions requestId={item.id} onRespond={onRespond} />
      ) : (
        <Decision status={item.status} />
      )}
    </section>
  );
}
