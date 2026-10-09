import { ChevronDown, ChevronRight, CircleAlert, LoaderCircle, RotateCw } from "lucide-react";

import { Tooltip } from "@/shared/ui/Tooltip";

import { ActionButton } from "./ActionButton";
import { InlineError } from "./InlineError";
import { PrExisting } from "./PrExisting";
import { PrForm } from "./PrForm";
import { PrGhHelp } from "./PrGhHelp";
import { prStateLabel } from "./pr-model";
import { currentPrOf, prViewKind } from "./pr-selectors";
import type { PrViewKind } from "./pr-types";
import { useVcs } from "./use-vcs";
import type { VcsAction } from "./vcs-types";

const SECTION_ERRORS: readonly VcsAction[] = ["loadPr", "generatePr", "createPr"];

function Header({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const pr = useVcs(currentPrOf);
  const loading = useVcs((state) => state.pr.loading);
  const failed = useVcs((state) => SECTION_ERRORS.some((action) => state.errors[action] !== undefined));
  const unseenFailure = failed && !expanded;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <Tooltip
      content={expanded ? "Hide the pull request" : "Show the pull request"}
      detail={unseenFailure ? "Something went wrong. Open this to read what" : "Open a pull request for this branch, or see the one that exists"}
      side="top"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex h-8 w-full items-center gap-1.5 px-3 text-left text-[11px] font-medium tracking-wide text-fg-subtle uppercase transition-colors hover:text-fg"
      >
        <Chevron aria-hidden className="size-3.5 shrink-0" />
        Pull request
        {loading ? <LoaderCircle aria-hidden className="size-3 animate-spin" /> : null}
        {unseenFailure ? <CircleAlert aria-hidden className="size-3 text-danger" /> : null}
        {pr === null ? null : (
          <span className="ml-auto truncate font-normal tracking-normal text-fg-muted normal-case">
            #{pr.number} {prStateLabel(pr)}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

function Checking() {
  return (
    <p className="flex items-center gap-2 p-3 text-xs text-fg-muted">
      <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
      Checking GitHub for a pull request
    </p>
  );
}

function TryAgain() {
  const loading = useVcs((state) => state.pr.loading);
  const loadPrInfo = useVcs((state) => state.loadPrInfo);
  return (
    <div className="p-2">
      <ActionButton
        label="Try again"
        icon={RotateCw}
        hint="Ask GitHub about this branch again"
        blockedReason={null}
        working={loading}
        onPress={() => {
          void loadPrInfo();
        }}
      />
    </div>
  );
}

function ExistingBody() {
  const pr = useVcs(currentPrOf);
  return pr === null ? null : <PrExisting pr={pr} />;
}

function Body({ kind }: { kind: Exclude<PrViewKind, "hidden"> }) {
  switch (kind) {
    case "checking":
      return <Checking />;
    case "failed":
      return <TryAgain />;
    case "ghMissing":
    case "signedOut":
      return <PrGhHelp kind={kind} />;
    case "existing":
      return <ExistingBody />;
    case "form":
      return <PrForm />;
  }
}

/** Open a pull request for the current branch, or see the one that exists. Hidden where it makes no sense. */
export function PullRequestSection() {
  const kind = useVcs(prViewKind);
  const expanded = useVcs((state) => state.prExpanded);
  const setPrExpanded = useVcs((state) => state.setPrExpanded);
  if (kind === "hidden") return null;
  return (
    <section aria-label="Pull request" className="shrink-0 border-t border-border bg-surface-1">
      <Header
        expanded={expanded}
        onToggle={() => {
          void setPrExpanded(!expanded);
        }}
      />
      {expanded ? (
        <div className="max-h-80 overflow-y-auto">
          <InlineError actions={SECTION_ERRORS} />
          <Body kind={kind} />
        </div>
      ) : null}
    </section>
  );
}
