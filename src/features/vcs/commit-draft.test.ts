import { describe, expect, test } from "bun:test";

import { EMPTY_DRAFT, SUBJECT_LIMIT, buildCommitMessage, isCommitShortcut } from "./commit-draft";

describe("buildCommitMessage", () => {
  test("is the subject alone when there is no description", () => {
    expect(buildCommitMessage({ subject: "fix(files): keep scroll", description: "" })).toBe("fix(files): keep scroll");
    expect(buildCommitMessage({ subject: "fix: a", description: "  \n " })).toBe("fix: a");
  });

  test("puts a blank line between the subject and the description", () => {
    expect(buildCommitMessage({ subject: "feat: a", description: "Why it matters." })).toBe("feat: a\n\nWhy it matters.");
  });

  test("trims both parts and keeps the lines inside the description", () => {
    const message = buildCommitMessage({ subject: "  feat: a  ", description: "\n first\n\n second \n" });
    expect(message).toBe("feat: a\n\nfirst\n\n second");
  });
});

describe("isCommitShortcut", () => {
  test("is Enter with Ctrl or Meta held", () => {
    expect(isCommitShortcut({ key: "Enter", ctrlKey: true, metaKey: false })).toBe(true);
    expect(isCommitShortcut({ key: "Enter", ctrlKey: false, metaKey: true })).toBe(true);
  });

  test("is not a plain Enter or another key", () => {
    expect(isCommitShortcut({ key: "Enter", ctrlKey: false, metaKey: false })).toBe(false);
    expect(isCommitShortcut({ key: "s", ctrlKey: true, metaKey: false })).toBe(false);
  });
});

describe("constants", () => {
  test("the subject limit is the conventional 72 and a new draft is empty", () => {
    expect(SUBJECT_LIMIT).toBe(72);
    expect(EMPTY_DRAFT).toEqual({ subject: "", description: "", includeBody: false });
  });
});
