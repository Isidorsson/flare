import type { CommitDraft } from "./vcs-types";

/** The conventional width of a commit subject; going over only warns. */
export const SUBJECT_LIMIT = 72;

export const COMMIT_SHORTCUT = "Ctrl+Enter";

export const EMPTY_DRAFT: CommitDraft = { subject: "", description: "", includeBody: false };

/** Subject, then a blank line and the description when there is one. */
export function buildCommitMessage(draft: Pick<CommitDraft, "subject" | "description">): string {
  const subject = draft.subject.trim();
  const description = draft.description.trim();
  return description === "" ? subject : `${subject}\n\n${description}`;
}

export function isCommitShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.key === "Enter" && (event.ctrlKey || event.metaKey);
}
