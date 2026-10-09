import { ArrowDownToLine, ArrowUpFromLine, CloudDownload, LoaderCircle, RotateCw, type LucideIcon } from "lucide-react";

import { IconButton } from "@/shared/ui/IconButton";
import { Tooltip } from "@/shared/ui/Tooltip";

import { syncSummary } from "./change-labels";
import { useVcs } from "./use-vcs";
import type { VcsStatus } from "./vcs-schemas";
import { actionBlockedReason, pullBlockedReason, pushBlockedReason } from "./vcs-selectors";
import type { MutatingAction } from "./vcs-types";

interface SyncButtonProps {
  action: MutatingAction;
  icon: LucideIcon;
  label: string;
  detail: string;
  blockedReason: string | null;
  onPress: () => void;
}

function SyncButton({ action, icon, label, detail, blockedReason, onPress }: SyncButtonProps) {
  const working = useVcs((state) => state.busy === action);
  return (
    <IconButton
      icon={working ? LoaderCircle : icon}
      label={label}
      detail={detail}
      disabledReason={blockedReason ?? undefined}
      className={working ? "[&>svg]:animate-spin" : ""}
      onClick={onPress}
    />
  );
}

export function SyncChip({ status }: { status: VcsStatus }) {
  if (status.branch === null) return null;
  const { label, detail } = syncSummary(status);
  return (
    <Tooltip content="Compared with the upstream branch" detail={detail}>
      <span tabIndex={0} className="shrink-0 rounded-full bg-surface-3 px-2 text-[11px] leading-5 text-fg-muted">
        {label}
      </span>
    </Tooltip>
  );
}

function pullDetail(status: VcsStatus): string {
  const target = status.upstream ?? "the upstream branch";
  return `Fast-forwards to ${target}. It stops instead of merging when the branches have diverged`;
}

function pushDetail(status: VcsStatus): string {
  if (status.upstream === null) return "Publishes this branch and sets its upstream";
  return `Sends your commits to ${status.upstream}`;
}

export function SyncControls({ status }: { status: VcsStatus }) {
  const fetch = useVcs((state) => state.fetch);
  const pull = useVcs((state) => state.pull);
  const push = useVcs((state) => state.push);
  const refresh = useVcs((state) => state.refresh);
  const fetchBlocked = useVcs(actionBlockedReason);
  const pullBlocked = useVcs(pullBlockedReason);
  const pushBlocked = useVcs(pushBlockedReason);
  return (
    <div className="flex shrink-0 items-center">
      <SyncButton
        action="fetch"
        icon={CloudDownload}
        label="Fetch"
        detail="Downloads new commits from the remote without touching your files"
        blockedReason={fetchBlocked}
        onPress={() => {
          void fetch();
        }}
      />
      <SyncButton
        action="pull"
        icon={ArrowDownToLine}
        label="Pull"
        detail={pullDetail(status)}
        blockedReason={pullBlocked}
        onPress={() => {
          void pull();
        }}
      />
      <SyncButton
        action="push"
        icon={ArrowUpFromLine}
        label="Push"
        detail={pushDetail(status)}
        blockedReason={pushBlocked}
        onPress={() => {
          void push();
        }}
      />
      <IconButton
        icon={RotateCw}
        label="Refresh"
        detail="Reads the git status again, for changes made outside Flare"
        onClick={() => {
          void refresh();
        }}
      />
    </div>
  );
}
