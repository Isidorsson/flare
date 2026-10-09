import { RotateCw } from "lucide-react";

import { ActionButton } from "./ActionButton";
import { CopyCommand } from "./CopyCommand";
import { GH_INSTALL_COMMAND, GH_LOGIN_COMMAND } from "./pr-model";
import { useVcs } from "./use-vcs";

interface HelpProps {
  kind: "ghMissing" | "signedOut";
}

interface Help {
  title: string;
  steps: string;
  command: string;
}

const HELP: Record<HelpProps["kind"], Help> = {
  ghMissing: {
    title: "The GitHub CLI is not installed",
    steps:
      "Flare opens pull requests through the GitHub CLI. Run this in a terminal, then restart Flare so it can find gh.",
    command: GH_INSTALL_COMMAND,
  },
  signedOut: {
    title: "The GitHub CLI is not signed in",
    steps: "Run this in a terminal and follow the prompts, then check again.",
    command: GH_LOGIN_COMMAND,
  },
};

function CheckAgain() {
  const loading = useVcs((state) => state.pr.loading);
  const loadPrInfo = useVcs((state) => state.loadPrInfo);
  return (
    <ActionButton
      label="Check again"
      icon={RotateCw}
      hint="Ask GitHub again whether you are signed in"
      blockedReason={null}
      working={loading}
      onPress={() => {
        void loadPrInfo();
      }}
    />
  );
}

/** What to do when `gh` is missing or signed out: the command, ready to copy. */
export function PrGhHelp({ kind }: HelpProps) {
  const { title, steps, command } = HELP[kind];
  return (
    <div className="space-y-2 p-2">
      <p className="text-xs font-medium text-fg">{title}</p>
      <p className="text-xs text-fg-muted">{steps}</p>
      <CopyCommand command={command} />
      {kind === "signedOut" ? <CheckAgain /> : null}
    </div>
  );
}
