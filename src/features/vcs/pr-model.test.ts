import { describe, expect, test } from "bun:test";

import { SUBJECT_LIMIT } from "./commit-draft";
import { pullRequest } from "./fake-pr-gateway";
import { PR_STATE_DETAILS, PR_TITLE_LIMIT, prDraftKey, prStateLabel } from "./pr-model";

describe("prStateLabel", () => {
  test("an open pull request is draft when it is marked as one", () => {
    expect(prStateLabel(pullRequest({ state: "open", isDraft: false }))).toBe("open");
    expect(prStateLabel(pullRequest({ state: "open", isDraft: true }))).toBe("draft");
  });

  test("merged and closed ones keep their state whatever the draft flag says", () => {
    expect(prStateLabel(pullRequest({ state: "merged", isDraft: true }))).toBe("merged");
    expect(prStateLabel(pullRequest({ state: "closed", isDraft: false }))).toBe("closed");
  });

  test("every label has a description for its tooltip", () => {
    for (const label of ["open", "draft", "merged", "closed"] as const) {
      expect(PR_STATE_DETAILS[label].length).toBeGreaterThan(0);
    }
  });
});

describe("prDraftKey", () => {
  test("differs by folder and by branch", () => {
    const keys = new Set([prDraftKey("C:/a", "x"), prDraftKey("C:/a", "y"), prDraftKey("C:/b", "x")]);
    expect(keys.size).toBe(3);
  });
});

test("the title counter uses the same width as a commit subject", () => {
  expect(PR_TITLE_LIMIT).toBe(SUBJECT_LIMIT);
});
