import { describe, expect, test } from "bun:test";

import { DEFAULT_PR_INFO, pullRequest } from "./fake-pr-gateway";
import { NOT_A_REPO, repoStatus } from "./fake-gateway";
import { EMPTY_PR_DRAFT, INITIAL_PR, prDraftKey } from "./pr-model";
import {
  NO_PR_GENERATOR_REASON,
  commitsAhead,
  createPrBlockedReason,
  currentPrOf,
  generatePrBlockedReason,
  prDraftOf,
  prTarget,
  prViewKind,
  selectedBase,
} from "./pr-selectors";
import type { PrDraft, PrViewKind } from "./pr-types";
import { INITIAL_SNAPSHOT } from "./vcs-controller";
import type { PrInfo, VcsStatus } from "./vcs-schemas";
import type { VcsSnapshot } from "./vcs-types";

const ROOT = "C:/p";
const BRANCH = "feat/login";

function onBranch(branch: string | null, overrides: Partial<VcsSnapshot> = {}, info: PrInfo | null = DEFAULT_PR_INFO): VcsSnapshot {
  return {
    ...INITIAL_SNAPSHOT,
    root: ROOT,
    status: repoStatus({ branch }),
    pr: { ...INITIAL_PR, info, branch },
    canGeneratePr: true,
    ...overrides,
  };
}

function withDraft(branch: string, draft: Partial<PrDraft>): Pick<VcsSnapshot, "prDrafts"> {
  return { prDrafts: { [prDraftKey(ROOT, branch)]: { ...EMPTY_PR_DRAFT, ...draft } } };
}

function kindOf(snapshot: VcsSnapshot): PrViewKind {
  return prViewKind(snapshot);
}

describe("when the Pull request section shows", () => {
  test("a feature branch with nothing yet shows the form", () => {
    expect(kindOf(onBranch(BRANCH))).toBe("form");
  });

  test("a feature branch that has a pull request shows it", () => {
    const info: PrInfo = { ...DEFAULT_PR_INFO, current: pullRequest() };
    const snapshot = onBranch(BRANCH, {}, info);
    expect(kindOf(snapshot)).toBe("existing");
    expect(currentPrOf(snapshot)?.number).toBe(42);
  });

  test("is hidden on the default base branch", () => {
    expect(kindOf(onBranch("main"))).toBe("hidden");
  });

  test("is hidden on the branch picked as the base, even when it is not the default", () => {
    expect(kindOf(onBranch("develop", withDraft("develop", { base: "develop" })))).toBe("hidden");
    expect(kindOf(onBranch("develop"))).toBe("form");
  });

  test("is hidden on a detached HEAD and outside a repository", () => {
    expect(kindOf(onBranch(null))).toBe("hidden");
    expect(kindOf(onBranch(BRANCH, { status: NOT_A_REPO }))).toBe("hidden");
    expect(kindOf(onBranch(BRANCH, { status: null }))).toBe("hidden");
  });

  test("waits for the first answer of gh before showing anything", () => {
    expect(kindOf(onBranch(BRANCH, { pr: { ...INITIAL_PR, loading: true } }, null))).toBe("hidden");
    expect(kindOf(onBranch(BRANCH, {}, null))).toBe("hidden");
  });

  test("explains a missing gh on a feature branch, but stays out of the way on main", () => {
    const missing: PrInfo = { ghAvailable: false, authenticated: false, defaultBase: null, current: null };
    expect(kindOf(onBranch(BRANCH, {}, missing))).toBe("ghMissing");
    expect(kindOf(onBranch("main", {}, missing))).toBe("hidden");
    expect(kindOf(onBranch("master", {}, missing))).toBe("hidden");
  });

  test("explains a signed-out gh on a feature branch", () => {
    const signedOut: PrInfo = { ...DEFAULT_PR_INFO, authenticated: false, defaultBase: null };
    expect(kindOf(onBranch(BRANCH, {}, signedOut))).toBe("signedOut");
    expect(kindOf(onBranch("main", {}, signedOut))).toBe("hidden");
  });

  test("says it is checking while the answer belongs to another branch", () => {
    const snapshot = onBranch(BRANCH, { pr: { ...INITIAL_PR, info: DEFAULT_PR_INFO, branch: "dev", loading: true } });
    expect(kindOf(snapshot)).toBe("checking");
    expect(currentPrOf(snapshot)).toBeNull();
  });

  test("a failed look-up shows as failed unless the answer for this branch is already in", () => {
    const stale = onBranch(BRANCH, { pr: { ...INITIAL_PR, info: DEFAULT_PR_INFO, branch: "dev" }, errors: { loadPr: "boom" } });
    expect(kindOf(stale)).toBe("failed");
    expect(kindOf(onBranch(BRANCH, { errors: { loadPr: "boom" } }, null))).toBe("failed");
    expect(kindOf(onBranch(BRANCH, { errors: { loadPr: "boom" } }))).toBe("form");
  });
});

describe("the draft of a branch", () => {
  test("is the one of this folder and branch, else the shared empty draft", () => {
    const snapshot = onBranch(BRANCH, withDraft(BRANCH, { title: "feat: login" }));
    expect(prDraftOf(snapshot).title).toBe("feat: login");
    expect(prDraftOf(onBranch("other", withDraft(BRANCH, { title: "feat: login" })))).toBe(EMPTY_PR_DRAFT);
    expect(prDraftOf(onBranch(null))).toBe(EMPTY_PR_DRAFT);
    expect(prDraftOf({ ...onBranch(BRANCH), root: null })).toBe(EMPTY_PR_DRAFT);
  });

  test("the base is the one picked, else the default of the repository", () => {
    expect(selectedBase(onBranch(BRANCH))).toBe("main");
    expect(selectedBase(onBranch(BRANCH, withDraft(BRANCH, { base: "develop" })))).toBe("develop");
    expect(selectedBase(onBranch(BRANCH, {}, { ...DEFAULT_PR_INFO, defaultBase: null }))).toBeNull();
  });

  test("the target needs the folder, the branch and a base", () => {
    expect(prTarget(onBranch(BRANCH))).toEqual({ root: ROOT, branch: BRANCH, base: "main", head: "abc1234" });
    expect(prTarget(onBranch(BRANCH, {}, { ...DEFAULT_PR_INFO, defaultBase: null }))).toBeNull();
    expect(prTarget(onBranch(null))).toBeNull();
  });
});

describe("how many commits a branch has over its base", () => {
  const ahead = (overrides: Partial<NonNullable<VcsSnapshot["pr"]["ahead"]>> = {}) => ({
    ...INITIAL_PR,
    info: DEFAULT_PR_INFO,
    branch: BRANCH,
    ahead: { branch: BRANCH, base: "main", head: "abc1234", commits: 0, ...overrides },
  });

  test("is known while the branch, the base and the commit are the ones that were looked at", () => {
    expect(commitsAhead(onBranch(BRANCH, { pr: ahead() }))).toBe(0);
    expect(commitsAhead(onBranch(BRANCH, { pr: ahead({ commits: 3 }) }))).toBe(3);
  });

  test("is unknown once the base, the branch or the commit changed", () => {
    expect(commitsAhead(onBranch(BRANCH, { pr: ahead({ base: "develop" }) }))).toBeNull();
    expect(commitsAhead(onBranch(BRANCH, { pr: ahead({ branch: "other" }) }))).toBeNull();
    const moved: VcsStatus = repoStatus({ branch: BRANCH, head: "def5678" });
    expect(commitsAhead(onBranch(BRANCH, { pr: ahead(), status: moved }))).toBeNull();
  });
});

describe("why Generate cannot be pressed", () => {
  test("not connected, not a form, generating, creating, or no base", () => {
    expect(generatePrBlockedReason(onBranch(BRANCH, { canGeneratePr: false }))).toBe(NO_PR_GENERATOR_REASON);
    expect(generatePrBlockedReason(onBranch("main"))).toBe("A pull request cannot be opened from here");
    expect(generatePrBlockedReason(onBranch(BRANCH, { generatingPr: true }))).toBe("A pull request is already being written");
    expect(generatePrBlockedReason(onBranch(BRANCH, { busy: "createPr" }))).toBe("The pull request is being created");
    expect(generatePrBlockedReason(onBranch(BRANCH, {}, { ...DEFAULT_PR_INFO, defaultBase: null }))).toBe(
      "Pick the branch the pull request merges into",
    );
  });

  test("is allowed on a feature branch, even before a title exists", () => {
    expect(generatePrBlockedReason(onBranch(BRANCH))).toBeNull();
  });
});

describe("why Create cannot be pressed", () => {
  const titled = withDraft(BRANCH, { title: "feat: login" });

  test("is allowed with a title on a feature branch", () => {
    expect(createPrBlockedReason(onBranch(BRANCH, titled))).toBeNull();
  });

  test("asks for a title, ignoring blanks", () => {
    expect(createPrBlockedReason(onBranch(BRANCH))).toBe("Write a pull request title first");
    expect(createPrBlockedReason(onBranch(BRANCH, withDraft(BRANCH, { title: "  " })))).toBe("Write a pull request title first");
  });

  test("names the other git action that is running", () => {
    expect(createPrBlockedReason(onBranch(BRANCH, { ...titled, busy: "push" }))).toBe("Another git action is still running");
  });

  test("waits for a pull request being written", () => {
    expect(createPrBlockedReason(onBranch(BRANCH, { ...titled, generatingPr: true }))).toBe("The pull request is being written");
  });

  test("says gh is the problem when it is", () => {
    const signedOut: PrInfo = { ...DEFAULT_PR_INFO, authenticated: false, defaultBase: null };
    expect(createPrBlockedReason(onBranch(BRANCH, titled, signedOut))).toBe("The GitHub CLI is not signed in");
  });

  test("says when the branch has nothing ahead of the base", () => {
    const empty = { ...INITIAL_PR, info: DEFAULT_PR_INFO, branch: BRANCH, ahead: { branch: BRANCH, base: "main", head: "abc1234", commits: 0 } };
    expect(createPrBlockedReason(onBranch(BRANCH, { ...titled, pr: empty }))).toBe("feat/login has no commits ahead of main");
  });
});
