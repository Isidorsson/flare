import { describe, expect, test } from "bun:test";

import {
  VcsCommandError,
  branchListSchema,
  changeSchema,
  commitResultSchema,
  fileDiffSchema,
  messageContextSchema,
  prContextSchema,
  prCreateResultSchema,
  prInfoSchema,
  pullRequestSchema,
  toVcsError,
  vcsBranchSchema,
  vcsFileSchema,
  vcsStatusSchema,
} from "./vcs-schemas";

const STATUS = {
  isRepo: true,
  branch: "main",
  head: "abc1234",
  upstream: "origin/main",
  ahead: 2,
  behind: 0,
  files: [
    { path: "src/a.ts", origPath: null, staged: "modified", unstaged: null },
    { path: "src/new.ts", origPath: "src/old.ts", staged: "renamed", unstaged: "modified" },
    { path: "notes.md", origPath: null, staged: null, unstaged: "untracked" },
  ],
};

describe("changeSchema", () => {
  test("accepts every kind of change the contract names", () => {
    for (const change of ["added", "modified", "deleted", "renamed", "typeChanged", "untracked", "conflicted"]) {
      expect(changeSchema.safeParse(change).success).toBe(true);
    }
  });

  test("rejects git's own letters and unknown kinds", () => {
    for (const change of ["M", "copied", "ignored", ""]) {
      expect(changeSchema.safeParse(change).success).toBe(false);
    }
  });
});

describe("vcsStatusSchema", () => {
  test("accepts what vcs_status returns for a repository", () => {
    const parsed = vcsStatusSchema.parse(STATUS);
    expect(parsed.files).toHaveLength(3);
    expect(parsed.files[1]).toEqual({ path: "src/new.ts", origPath: "src/old.ts", staged: "renamed", unstaged: "modified" });
  });

  test("accepts a folder outside a repository: no branch, no files", () => {
    const parsed = vcsStatusSchema.parse({
      isRepo: false,
      branch: null,
      head: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
    });
    expect(parsed.isRepo).toBe(false);
  });

  test("accepts a detached HEAD and a branch without an upstream", () => {
    const detached = vcsStatusSchema.parse({ ...STATUS, branch: null, upstream: null });
    expect(detached.branch).toBeNull();
    expect(detached.upstream).toBeNull();
  });

  test("rejects negative or fractional counts and missing fields", () => {
    expect(vcsStatusSchema.safeParse({ ...STATUS, ahead: -1 }).success).toBe(false);
    expect(vcsStatusSchema.safeParse({ ...STATUS, behind: 1.5 }).success).toBe(false);
    expect(vcsStatusSchema.safeParse({ ...STATUS, files: undefined }).success).toBe(false);
    expect(vcsStatusSchema.safeParse({ ...STATUS, isRepo: undefined }).success).toBe(false);
  });

  test("rejects snake_case field names, which the Rust side must not send", () => {
    const { isRepo, ...rest } = STATUS;
    expect(vcsStatusSchema.safeParse({ ...rest, is_repo: isRepo }).success).toBe(false);
  });
});

describe("vcsFileSchema", () => {
  test("needs a path and both sides, each possibly null", () => {
    expect(vcsFileSchema.safeParse({ path: "a", origPath: null, staged: null, unstaged: null }).success).toBe(true);
    expect(vcsFileSchema.safeParse({ path: "", origPath: null, staged: null, unstaged: null }).success).toBe(false);
    expect(vcsFileSchema.safeParse({ path: "a", origPath: null, staged: "M", unstaged: null }).success).toBe(false);
    expect(vcsFileSchema.safeParse({ path: "a", staged: null, unstaged: null }).success).toBe(false);
  });
});

describe("fileDiffSchema", () => {
  test("a missing side is null, not an empty string", () => {
    const added = fileDiffSchema.parse({ path: "a.ts", original: null, modified: "x\n", binary: false });
    expect(added.original).toBeNull();
    const deleted = fileDiffSchema.parse({ path: "a.ts", original: "x\n", modified: null, binary: false });
    expect(deleted.modified).toBeNull();
  });

  test("a binary file carries the flag", () => {
    expect(fileDiffSchema.parse({ path: "logo.png", original: null, modified: null, binary: true }).binary).toBe(true);
    expect(fileDiffSchema.safeParse({ path: "logo.png", original: null, modified: null }).success).toBe(false);
  });
});

describe("commitResultSchema", () => {
  test("carries the new commit and the fresh status", () => {
    const parsed = commitResultSchema.parse({ commit: "def5678", summary: "1 file changed", status: STATUS });
    expect(parsed.commit).toBe("def5678");
    expect(parsed.status.ahead).toBe(2);
  });

  test("rejects an empty commit id and a status that is not one", () => {
    expect(commitResultSchema.safeParse({ commit: "", summary: "", status: STATUS }).success).toBe(false);
    expect(commitResultSchema.safeParse({ commit: "a", summary: "", status: { isRepo: true } }).success).toBe(false);
  });
});

describe("branches", () => {
  test("accepts local and remote branches", () => {
    const parsed = branchListSchema.parse([
      { name: "main", remote: false, current: true, upstream: "origin/main" },
      { name: "origin/dev", remote: true, current: false, upstream: null },
    ]);
    expect(parsed.map((branch) => branch.name)).toEqual(["main", "origin/dev"]);
  });

  test("a branch needs a name and all three flags", () => {
    expect(vcsBranchSchema.safeParse({ name: "", remote: false, current: false, upstream: null }).success).toBe(false);
    expect(vcsBranchSchema.safeParse({ name: "a", remote: false, upstream: null }).success).toBe(false);
  });
});

describe("messageContextSchema", () => {
  const context = {
    source: "staged",
    stat: " a | 1 +",
    patch: "diff",
    truncated: false,
    recentSubjects: ["fix: a"],
    branch: "feat/login",
    recentBodies: ["Why it was needed."],
  };

  test("accepts the staged and the all-changes source", () => {
    expect(messageContextSchema.parse(context).source).toBe("staged");
    expect(messageContextSchema.parse({ ...context, source: "all", recentSubjects: [] }).source).toBe("all");
  });

  test("carries the branch name and the recent bodies", () => {
    const parsed = messageContextSchema.parse(context);
    expect(parsed.branch).toBe("feat/login");
    expect(parsed.recentBodies).toEqual(["Why it was needed."]);
  });

  test("a detached HEAD has no branch, and no recent body is an empty list", () => {
    const parsed = messageContextSchema.parse({ ...context, branch: null, recentBodies: [] });
    expect(parsed.branch).toBeNull();
    expect(parsed.recentBodies).toEqual([]);
  });

  test("rejects an unknown source, a missing truncated flag and a context without the new fields", () => {
    expect(messageContextSchema.safeParse({ ...context, source: "working" }).success).toBe(false);
    expect(messageContextSchema.safeParse({ ...context, truncated: undefined }).success).toBe(false);
    expect(messageContextSchema.safeParse({ ...context, branch: undefined }).success).toBe(false);
    expect(messageContextSchema.safeParse({ ...context, recentBodies: undefined }).success).toBe(false);
    expect(messageContextSchema.safeParse({ ...context, branch: "" }).success).toBe(false);
  });
});

const PULL_REQUEST = {
  number: 12,
  url: "https://github.com/acme/app/pull/12",
  title: "feat(auth): add login",
  state: "open",
  isDraft: false,
  base: "main",
};

describe("pullRequestSchema", () => {
  test("accepts what the pull request commands return", () => {
    expect(pullRequestSchema.parse(PULL_REQUEST)).toMatchObject(PULL_REQUEST);
    for (const state of ["open", "closed", "merged"]) {
      expect(pullRequestSchema.safeParse({ ...PULL_REQUEST, state }).success).toBe(true);
    }
  });

  test("rejects an unknown state, a number that is not positive and a missing draft flag", () => {
    expect(pullRequestSchema.safeParse({ ...PULL_REQUEST, state: "OPEN" }).success).toBe(false);
    expect(pullRequestSchema.safeParse({ ...PULL_REQUEST, number: 0 }).success).toBe(false);
    expect(pullRequestSchema.safeParse({ ...PULL_REQUEST, isDraft: undefined }).success).toBe(false);
    expect(pullRequestSchema.safeParse({ ...PULL_REQUEST, base: "" }).success).toBe(false);
  });

  test("only a web address can be opened in the browser", () => {
    expect(pullRequestSchema.safeParse({ ...PULL_REQUEST, url: "http://ghe.local/acme/app/pull/12" }).success).toBe(true);
    expect(pullRequestSchema.safeParse({ ...PULL_REQUEST, url: "file:///C:/Windows/System32/calc.exe" }).success).toBe(false);
    expect(pullRequestSchema.safeParse({ ...PULL_REQUEST, url: "javascript:alert(1)" }).success).toBe(false);
    expect(pullRequestSchema.safeParse({ ...PULL_REQUEST, url: "not a url" }).success).toBe(false);
  });
});

describe("prInfoSchema", () => {
  const info = { ghAvailable: true, authenticated: true, defaultBase: "main", current: PULL_REQUEST };

  test("accepts a branch with a pull request and one without", () => {
    expect(prInfoSchema.parse(info).current?.number).toBe(12);
    expect(prInfoSchema.parse({ ...info, current: null }).current).toBeNull();
  });

  test("a missing or signed-out gh is reported in the fields, with no default base", () => {
    const missing = prInfoSchema.parse({ ghAvailable: false, authenticated: false, defaultBase: null, current: null });
    expect(missing.ghAvailable).toBe(false);
    const signedOut = prInfoSchema.parse({ ghAvailable: true, authenticated: false, defaultBase: null, current: null });
    expect(signedOut.authenticated).toBe(false);
  });

  test("rejects snake_case names and missing fields", () => {
    const { ghAvailable, ...rest } = info;
    expect(prInfoSchema.safeParse({ ...rest, gh_available: ghAvailable }).success).toBe(false);
    expect(prInfoSchema.safeParse({ ...info, current: undefined }).success).toBe(false);
    expect(prInfoSchema.safeParse({ ...info, defaultBase: "" }).success).toBe(false);
  });
});

describe("prContextSchema", () => {
  const context = {
    base: "main",
    branch: "feat/login",
    commits: [
      { subject: "feat: form", body: "" },
      { subject: "fix: trim", body: "Pasted text has spaces." },
    ],
    stat: " a | 1 +",
    truncated: false,
  };

  test("accepts commits with and without a body, oldest first", () => {
    const parsed = prContextSchema.parse(context);
    expect(parsed.commits.map((commit) => commit.subject)).toEqual(["feat: form", "fix: trim"]);
    expect(parsed.commits[0]?.body).toBe("");
  });

  test("accepts a branch with nothing ahead of its base", () => {
    expect(prContextSchema.parse({ ...context, commits: [] }).commits).toEqual([]);
  });

  test("rejects a commit without a body field and a missing base", () => {
    expect(prContextSchema.safeParse({ ...context, commits: [{ subject: "feat: form" }] }).success).toBe(false);
    expect(prContextSchema.safeParse({ ...context, base: undefined }).success).toBe(false);
    expect(prContextSchema.safeParse({ ...context, truncated: undefined }).success).toBe(false);
  });
});

describe("prCreateResultSchema", () => {
  test("carries the pull request and the fresh status", () => {
    const parsed = prCreateResultSchema.parse({ pr: PULL_REQUEST, status: STATUS });
    expect(parsed.pr.number).toBe(12);
    expect(parsed.status.branch).toBe("main");
  });

  test("rejects a result without the status or with a pull request that is not one", () => {
    expect(prCreateResultSchema.safeParse({ pr: PULL_REQUEST }).success).toBe(false);
    expect(prCreateResultSchema.safeParse({ pr: { number: 1 }, status: STATUS }).success).toBe(false);
  });
});

describe("toVcsError", () => {
  test("turns the { code, message } payload of a rejected command into an error that keeps the code", () => {
    const error = toVcsError({ code: "nothing_staged", message: "Nothing is staged" });
    expect(error).toBeInstanceOf(VcsCommandError);
    expect(error.message).toBe("Nothing is staged");
    expect(error instanceof VcsCommandError && error.code).toBe("nothing_staged");
  });

  test("keeps an Error and wraps a string or any other value", () => {
    const original = new Error("boom");
    expect(toVcsError(original)).toBe(original);
    expect(toVcsError("plain").message).toBe("plain");
    expect(toVcsError({ nope: 1 }).message).toBe('{"nope":1}');
  });
});
