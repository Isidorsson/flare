import { SquareTerminal } from "lucide-react";

import type { Thread } from "@/features/agent/thread-types";
import { useLayout } from "@/features/shell/use-layout";
import { hasClaude, loadedProfiles, openClaudeTerminal, useTerminalProfiles } from "@/features/terminal";
import { IconButton } from "@/shared/ui/IconButton";

function unavailableReason(sessionId: string | null, claudeMissing: boolean): string | undefined {
  if (sessionId === null) return "Send a message first so there is a session to continue";
  if (claudeMissing) return "Claude Code was not found on PATH. Install it or set FLARE_CLAUDE_PATH";
  return undefined;
}

/** Forks the chat's session into the Claude Code CLI in a terminal tab; the chat keeps its own copy. */
export function ContinueInClaudeButton({ thread }: { thread: Thread | null }) {
  const showTerminal = useLayout((state) => state.showTerminal);
  const claudeMissing = useTerminalProfiles(
    (state) => state.load.kind === "loaded" && !hasClaude(loadedProfiles(state)),
  );
  const sessionId = thread?.sessionId ?? null;

  return (
    <IconButton
      icon={SquareTerminal}
      label="Continue in Claude Code"
      detail="Opens this conversation in the Claude Code CLI as a forked session"
      disabledReason={unavailableReason(sessionId, claudeMissing)}
      onClick={() => {
        if (sessionId === null) return;
        showTerminal();
        openClaudeTerminal(sessionId);
      }}
    />
  );
}
