import type { CanUseTool, PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { BridgeEvent, PermissionDecision } from "@flare/protocol";

type Emit = (event: BridgeEvent) => void;

interface PendingRequest {
  toolName: string;
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[] | undefined;
  settle: (result: PermissionResult) => void;
}

export class PermissionBroker {
  readonly #emit: Emit;
  readonly #pending = new Map<string, PendingRequest>();

  constructor(emit: Emit) {
    this.#emit = emit;
  }

  readonly canUseTool = (
    toolName: string,
    input: Record<string, unknown>,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult> =>
    new Promise<PermissionResult>((resolve) => {
      const { requestId, suggestions, signal } = options;
      const settle = (result: PermissionResult) => {
        this.#pending.delete(requestId);
        resolve(result);
      };
      this.#pending.set(requestId, { toolName, input, suggestions, settle });
      signal.addEventListener("abort", () => settle(denied("The request was cancelled.")), { once: true });
      this.#emit({ type: "permission.request", requestId, toolName, input });
    });

  respond(requestId: string, decision: PermissionDecision): boolean {
    const request = this.#pending.get(requestId);
    if (!request) return false;
    request.settle(toResult(request, decision));
    return true;
  }

  denyAll(reason: string): void {
    for (const request of [...this.#pending.values()]) request.settle(denied(reason));
  }

  get pendingCount(): number {
    return this.#pending.size;
  }
}

export function sessionPermissionUpdates(
  toolName: string,
  suggestions: PermissionUpdate[] | undefined,
): PermissionUpdate[] {
  if (suggestions === undefined || suggestions.length === 0) {
    return [{ type: "addRules", rules: [{ toolName }], behavior: "allow", destination: "session" }];
  }
  return suggestions.map((suggestion) => ({ ...suggestion, destination: "session" }));
}

function toResult(request: PendingRequest, decision: PermissionDecision): PermissionResult {
  switch (decision) {
    case "allow":
      return { behavior: "allow", updatedInput: request.input };
    case "allowSession":
      return {
        behavior: "allow",
        updatedInput: request.input,
        updatedPermissions: sessionPermissionUpdates(request.toolName, request.suggestions),
      };
    case "deny":
      return denied("The user denied this action.");
  }
}

function denied(message: string): PermissionResult {
  return { behavior: "deny", message };
}
