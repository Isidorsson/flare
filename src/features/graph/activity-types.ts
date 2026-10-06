export const ACTIVITY_KINDS = ["read", "edit", "create", "search", "run"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const AGENT_STATUSES = ["working", "thinking", "idle", "done"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type ActivitySource = "agent" | "disk";

export interface ActivityInput {
  path?: string | undefined;
  kind: ActivityKind;
  detail?: string | undefined;
  linesChanged?: number | undefined;
  source?: ActivitySource | undefined;
}

export type PulseKind = "read" | "change";

export function activityKindOf(kind: PulseKind): ActivityKind {
  return kind === "change" ? "edit" : "read";
}

export function isEditKind(kind: ActivityKind): boolean {
  return kind === "edit" || kind === "create";
}
