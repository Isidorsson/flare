import { GitPullRequestCreate, Sparkles } from "lucide-react";

import { ActionButton } from "./ActionButton";
import { FIELD } from "./field-style";
import { PrBasePicker } from "./PrBasePicker";
import { PR_TITLE_LIMIT } from "./pr-model";
import { createPrBlockedReason, currentBranchOf, generatePrBlockedReason, prDraftOf, selectedBase } from "./pr-selectors";
import { SwitchButton } from "./SwitchButton";
import { useVcs } from "./use-vcs";

function TitleField() {
  const title = useVcs((state) => prDraftOf(state).title);
  const generating = useVcs((state) => state.generatingPr);
  const setPrTitle = useVcs((state) => state.setPrTitle);
  const over = title.length > PR_TITLE_LIMIT;
  return (
    <div className="relative">
      <input
        value={title}
        onChange={(event) => {
          setPrTitle(event.target.value);
        }}
        disabled={generating}
        aria-label="Pull request title"
        placeholder="Pull request title"
        spellCheck
        className={`${FIELD} h-8 pr-14`}
      />
      <span
        aria-label={`${String(title.length)} of ${String(PR_TITLE_LIMIT)} title characters`}
        className={`pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] tabular-nums ${over ? "text-warning" : "text-fg-subtle"}`}
      >
        {title.length}/{PR_TITLE_LIMIT}
      </span>
    </div>
  );
}

function BodyField() {
  const body = useVcs((state) => prDraftOf(state).body);
  const generating = useVcs((state) => state.generatingPr);
  const setPrBody = useVcs((state) => state.setPrBody);
  return (
    <textarea
      value={body}
      onChange={(event) => {
        setPrBody(event.target.value);
      }}
      disabled={generating}
      rows={6}
      aria-label="Pull request description"
      placeholder="Description (Markdown)"
      spellCheck
      className={`${FIELD} max-h-56 min-h-24 resize-y py-1.5`}
    />
  );
}

function GenerateRow() {
  const generating = useVcs((state) => state.generatingPr);
  const blockedReason = useVcs(generatePrBlockedReason);
  const base = useVcs(selectedBase);
  const isDraft = useVcs((state) => prDraftOf(state).isDraft);
  const generatePr = useVcs((state) => state.generatePr);
  const setPrDraft = useVcs((state) => state.setPrDraft);
  return (
    <div className="flex items-center justify-between gap-2">
      <ActionButton
        label="Generate"
        icon={Sparkles}
        hint="Write the title and description with Claude"
        detail={base === null ? undefined : `Describes the commits ahead of ${base}`}
        blockedReason={blockedReason}
        working={generating}
        onPress={() => {
          void generatePr();
        }}
      />
      <SwitchButton
        label="draft"
        checked={isDraft}
        hint="Open it as a draft"
        detail="On: marked as a draft, not ready for review. Off: ready for review right away"
        onChange={setPrDraft}
      />
    </div>
  );
}

function CreateRow() {
  const busy = useVcs((state) => state.busy);
  const blockedReason = useVcs(createPrBlockedReason);
  const branch = useVcs(currentBranchOf);
  const base = useVcs(selectedBase);
  const createPr = useVcs((state) => state.createPr);
  return (
    <ActionButton
      label="Create PR"
      icon={GitPullRequestCreate}
      variant="primary"
      hint="Push the branch if needed, then open the pull request on GitHub"
      detail={branch === null || base === null ? undefined : `Merges ${branch} into ${base}`}
      blockedReason={blockedReason}
      working={busy === "createPr"}
      onPress={() => {
        void createPr();
      }}
    />
  );
}

/** Base branch, title, description and the buttons to write and open a pull request. */
export function PrForm() {
  return (
    <div className="space-y-2 p-2">
      <PrBasePicker />
      <TitleField />
      <BodyField />
      <GenerateRow />
      <CreateRow />
    </div>
  );
}
