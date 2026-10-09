import { describe, expect, test } from "bun:test";

import { EMPTY_DRAFT } from "./commit-draft";
import { NOT_A_REPO, file, repoStatus } from "./fake-gateway";
import { INITIAL_SNAPSHOT } from "./vcs-controller";
import type { VcsStatus } from "./vcs-schemas";
import {
  BUSY_REASON,
  NO_GENERATOR_REASON,
  actionBlockedReason,
  changedFileCount,
  commitAndPushBlockedReason,
  commitBlockedReason,
  draftOf,
  generateBlockedReason,
  pullBlockedReason,
  pushBlockedReason,
} from "./vcs-selectors";
import type { CommitDraft, VcsSnapshot } from "./vcs-types";

const ROOT = "C:/p";

function snapshot(overrides: Partial<VcsSnapshot> & { status?: VcsStatus | null } = {}): VcsSnapshot {
  return { ...INITIAL_SNAPSHOT, root: ROOT, status: repoStatus(), ...overrides };
}

function withDraft(draft: Partial<CommitDraft>): Pick<VcsSnapshot, "drafts"> {
  return { drafts: { [ROOT]: { ...EMPTY_DRAFT, ...draft } } };
}

const READY = {
  status: repoStatus({ files: [file("a.ts", "modified", null)] }),
  ...withDraft({ subject: "feat: a" }),
} satisfies Partial<VcsSnapshot>;

describe("draftOf", () => {
  test("is the draft of the open root, and the shared empty draft for a root without one", () => {
    expect(draftOf(snapshot(withDraft({ subject: "x" }))).subject).toBe("x");
    expect(draftOf(snapshot())).toBe(EMPTY_DRAFT);
    expect(draftOf(snapshot({ root: null }))).toBe(EMPTY_DRAFT);
  });

  test("keeps each root's draft apart", () => {
    const drafts = { [ROOT]: { ...EMPTY_DRAFT, subject: "one" }, "C:/q": { ...EMPTY_DRAFT, subject: "two" } };
    expect(draftOf(snapshot({ drafts })).subject).toBe("one");
    expect(draftOf(snapshot({ drafts, root: "C:/q" })).subject).toBe("two");
  });
});

describe("changedFileCount", () => {
  test("counts files of a repository, and nothing before the first status or outside one", () => {
    expect(changedFileCount(snapshot({ status: repoStatus({ files: [file("a", null, "modified"), file("b", "added", null)] }) }))).toBe(2);
    expect(changedFileCount(snapshot({ status: null }))).toBe(0);
    expect(changedFileCount(snapshot({ status: NOT_A_REPO }))).toBe(0);
  });
});

describe("actionBlockedReason", () => {
  test("is null for a repository with nothing running", () => {
    expect(actionBlockedReason(snapshot())).toBeNull();
  });

  test("blocks a folder that is not a repository and an action while another runs", () => {
    expect(actionBlockedReason(snapshot({ status: NOT_A_REPO }))).toContain("not a git repository");
    expect(actionBlockedReason(snapshot({ status: null }))).toContain("not a git repository");
    expect(actionBlockedReason(snapshot({ busy: "fetch" }))).toBe(BUSY_REASON);
  });
});

describe("pullBlockedReason and pushBlockedReason", () => {
  test("pull needs a branch with an upstream", () => {
    expect(pullBlockedReason(snapshot())).toBeNull();
    expect(pullBlockedReason(snapshot({ status: repoStatus({ upstream: null }) }))).toContain("no upstream");
    expect(pullBlockedReason(snapshot({ status: repoStatus({ branch: null }) }))).toContain("detached");
    expect(pullBlockedReason(snapshot({ busy: "push" }))).toBe(BUSY_REASON);
  });

  test("push has nothing to do when the branch is in step with its upstream", () => {
    expect(pushBlockedReason(snapshot())).toBe("No commits to push");
    expect(pushBlockedReason(snapshot({ status: repoStatus({ ahead: 1 }) }))).toBeNull();
  });

  test("push publishes a branch that has no upstream yet, but not a detached HEAD", () => {
    expect(pushBlockedReason(snapshot({ status: repoStatus({ upstream: null }) }))).toBeNull();
    expect(pushBlockedReason(snapshot({ status: repoStatus({ branch: null, ahead: 1 }) }))).toContain("detached");
  });
});

describe("commitBlockedReason", () => {
  test("is null with a staged file and a subject", () => {
    expect(commitBlockedReason(snapshot(READY))).toBeNull();
  });

  test("asks to stage something first, then to write a subject", () => {
    const unstagedOnly = { ...READY, status: repoStatus({ files: [file("a.ts", null, "modified")] }) };
    expect(commitBlockedReason(snapshot(unstagedOnly))).toBe("Stage at least one file to commit");
    expect(commitBlockedReason(snapshot({ ...READY, ...withDraft({ subject: "   " }) }))).toBe("Write a commit subject first");
  });

  test("is blocked by a running action, by a generation in progress and by merge conflicts", () => {
    expect(commitBlockedReason(snapshot({ ...READY, busy: "push" }))).toBe(BUSY_REASON);
    expect(commitBlockedReason(snapshot({ ...READY, generating: true }))).toContain("generated");
    const conflicted = { ...READY, status: repoStatus({ files: [file("a.ts", "modified", null), file("c.ts", null, "conflicted")] }) };
    expect(commitBlockedReason(snapshot(conflicted))).toContain("conflicts");
  });

  test("a conflicted file does not count as staged", () => {
    const onlyConflict = { ...READY, status: repoStatus({ files: [file("c.ts", "conflicted", null)] }) };
    expect(commitBlockedReason(snapshot(onlyConflict))).not.toBeNull();
  });
});

describe("commitAndPushBlockedReason", () => {
  test("adds the detached HEAD check to the commit rules", () => {
    expect(commitAndPushBlockedReason(snapshot(READY))).toBeNull();
    const detached = { ...READY, status: repoStatus({ branch: null, files: [file("a.ts", "modified", null)] }) };
    expect(commitAndPushBlockedReason(snapshot(detached))).toContain("detached");
    expect(commitAndPushBlockedReason(snapshot({ ...READY, ...withDraft({}) }))).toBe("Write a commit subject first");
  });

  test("does not need commits ahead, because the commit adds one", () => {
    expect(commitAndPushBlockedReason(snapshot(READY))).toBeNull();
  });
});

describe("generateBlockedReason", () => {
  const ready = snapshot({ ...READY, canGenerate: true });

  test("explains that no generator is connected before anything else", () => {
    expect(generateBlockedReason(snapshot({ ...READY, status: NOT_A_REPO }))).toBe(NO_GENERATOR_REASON);
  });

  test("is allowed with changes, staged or not, even while a fetch runs", () => {
    expect(generateBlockedReason(ready)).toBeNull();
    expect(generateBlockedReason({ ...ready, status: repoStatus({ files: [file("a", null, "modified")] }) })).toBeNull();
    expect(generateBlockedReason({ ...ready, busy: "fetch" })).toBeNull();
  });

  test("is blocked without changes, while generating and while a commit runs", () => {
    expect(generateBlockedReason({ ...ready, status: repoStatus() })).toContain("no changes");
    expect(generateBlockedReason({ ...ready, generating: true })).toContain("already");
    expect(generateBlockedReason({ ...ready, busy: "commit" })).toContain("commit is in progress");
    expect(generateBlockedReason({ ...ready, status: NOT_A_REPO })).toContain("not a git repository");
  });
});
