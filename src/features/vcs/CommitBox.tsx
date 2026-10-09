import { ArrowUpFromLine, GitCommitHorizontal, Sparkles } from "lucide-react";
import type { KeyboardEvent } from "react";

import { ActionButton } from "./ActionButton";
import { COMMIT_SHORTCUT, SUBJECT_LIMIT, isCommitShortcut } from "./commit-draft";
import { DescriptionToggle } from "./DescriptionToggle";
import { InlineError } from "./InlineError";
import { useVcs } from "./use-vcs";
import { commitAndPushBlockedReason, commitBlockedReason, draftOf, generateBlockedReason } from "./vcs-selectors";
import type { VcsAction } from "./vcs-types";

const COMMIT_ERRORS: readonly VcsAction[] = ["generate", "commit", "commitAndPush"];

const FIELD =
  "w-full rounded-md border border-border bg-surface-1 px-2 text-xs text-fg outline-none select-text placeholder:text-fg-subtle focus:border-border-strong disabled:opacity-60";

function SubjectField({ onKeyDown }: { onKeyDown: (event: KeyboardEvent) => void }) {
  const subject = useVcs((state) => draftOf(state).subject);
  const generating = useVcs((state) => state.generating);
  const setSubject = useVcs((state) => state.setSubject);
  const over = subject.length > SUBJECT_LIMIT;
  return (
    <div className="relative">
      <input
        value={subject}
        onChange={(event) => {
          setSubject(event.target.value);
        }}
        onKeyDown={onKeyDown}
        disabled={generating}
        aria-label="Commit subject"
        placeholder="Commit subject"
        spellCheck
        className={`${FIELD} h-8 pr-14`}
      />
      <span
        aria-label={`${String(subject.length)} of ${String(SUBJECT_LIMIT)} characters`}
        className={`pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] tabular-nums ${over ? "text-warning" : "text-fg-subtle"}`}
      >
        {subject.length}/{SUBJECT_LIMIT}
      </span>
    </div>
  );
}

function DescriptionField({ onKeyDown }: { onKeyDown: (event: KeyboardEvent) => void }) {
  const description = useVcs((state) => draftOf(state).description);
  const generating = useVcs((state) => state.generating);
  const setDescription = useVcs((state) => state.setDescription);
  return (
    <textarea
      value={description}
      onChange={(event) => {
        setDescription(event.target.value);
      }}
      onKeyDown={onKeyDown}
      disabled={generating}
      rows={3}
      aria-label="Commit description"
      placeholder="Description (optional)"
      spellCheck
      className={`${FIELD} max-h-40 min-h-16 resize-y py-1.5`}
    />
  );
}

function GenerateRow() {
  const generating = useVcs((state) => state.generating);
  const blockedReason = useVcs(generateBlockedReason);
  const nothingStaged = useVcs((state) => state.status?.files.every((file) => file.staged === null) ?? true);
  const generateMessage = useVcs((state) => state.generateMessage);
  return (
    <div className="flex items-center justify-between gap-2">
      <ActionButton
        label="Generate"
        icon={Sparkles}
        hint="Write the commit message with Claude"
        detail={nothingStaged ? "Nothing is staged, so it describes all changes" : "Describes the staged changes"}
        blockedReason={blockedReason}
        working={generating}
        onPress={() => {
          void generateMessage();
        }}
      />
      <DescriptionToggle />
    </div>
  );
}

function CommitRow() {
  const busy = useVcs((state) => state.busy);
  const commitBlocked = useVcs(commitBlockedReason);
  const pushBlocked = useVcs(commitAndPushBlockedReason);
  const commit = useVcs((state) => state.commit);
  const commitAndPush = useVcs((state) => state.commitAndPush);
  return (
    <div className="flex items-center gap-2">
      <ActionButton
        label="Commit"
        icon={GitCommitHorizontal}
        variant="primary"
        hint="Commit the staged files"
        shortcut={COMMIT_SHORTCUT}
        blockedReason={commitBlocked}
        working={busy === "commit"}
        onPress={() => {
          void commit();
        }}
      />
      <ActionButton
        label="Commit & Push"
        icon={ArrowUpFromLine}
        hint="Commit the staged files, then push the branch"
        blockedReason={pushBlocked}
        working={busy === "commitAndPush"}
        onPress={() => {
          void commitAndPush();
        }}
      />
    </div>
  );
}

export function CommitBox() {
  const commit = useVcs((state) => state.commit);

  function onKeyDown(event: KeyboardEvent) {
    if (!isCommitShortcut(event)) return;
    event.preventDefault();
    void commit();
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface-1">
      <InlineError actions={COMMIT_ERRORS} />
      <div className="space-y-2 p-2">
        <SubjectField onKeyDown={onKeyDown} />
        <DescriptionField onKeyDown={onKeyDown} />
        <GenerateRow />
        <CommitRow />
      </div>
    </div>
  );
}
