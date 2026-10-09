import { describe, expect, test } from "bun:test";

import { describeVcsError } from "./vcs-errors";
import { VcsCommandError, toVcsError } from "./vcs-schemas";

describe("describeVcsError", () => {
  test("turns every code the vcs commands add into a plain sentence", () => {
    const codes = [
      "invalid_request",
      "not_a_repository",
      "empty_message",
      "nothing_staged",
      "nothing_to_describe",
      "detached_head",
      "no_remote",
      "no_upstream",
      "gh_missing",
      "gh_unauthenticated",
      "no_commits",
      "on_base_branch",
    ];
    for (const code of codes) {
      const message = describeVcsError(new VcsCommandError(code, "raw message from rust"));
      expect(message).not.toBe("raw message from rust");
      expect(message.endsWith(".")).toBe(true);
    }
  });

  test("names the cause for the codes users can act on", () => {
    expect(describeVcsError(new VcsCommandError("nothing_staged", "x"))).toContain("Stage at least one file");
    expect(describeVcsError(new VcsCommandError("no_remote", "x"))).toContain("no remote");
    expect(describeVcsError(new VcsCommandError("no_upstream", "x"))).toContain("upstream");
    expect(describeVcsError(new VcsCommandError("detached_head", "x"))).toContain("Switch to a branch");
    expect(describeVcsError(new VcsCommandError("nothing_to_describe", "x"))).toContain("no changes");
  });

  test("tells the user how to fix a missing or signed-out GitHub CLI", () => {
    expect(describeVcsError(new VcsCommandError("gh_missing", "x"))).toContain("winget install GitHub.cli");
    expect(describeVcsError(new VcsCommandError("gh_unauthenticated", "x"))).toContain("gh auth login");
  });

  test("explains a branch with nothing to open a pull request for, and the base branch", () => {
    expect(describeVcsError(new VcsCommandError("no_commits", "x"))).toContain("no commits ahead of the base");
    expect(describeVcsError(new VcsCommandError("on_base_branch", "x"))).toContain("Switch to a feature branch");
  });

  test("keeps the raw message of an invalid request, since it points at a bug", () => {
    expect(describeVcsError(new VcsCommandError("invalid_request", "paths must not be empty"))).toContain("paths must not be empty");
  });

  test("passes git's own failures through unchanged", () => {
    expect(describeVcsError(new VcsCommandError("git_failed", "fatal: unable to access remote"))).toBe("fatal: unable to access remote");
    expect(describeVcsError(new Error("boom"))).toBe("boom");
    expect(describeVcsError("plain")).toBe("plain");
  });

  test("works on what a rejected invoke turns into", () => {
    expect(describeVcsError(toVcsError({ code: "no_upstream", message: "x" }))).toContain("upstream");
  });
});
