import { describe, expect, test } from "bun:test";

import { branchNameProblem, groupBranches, switchTargetLabel } from "./branch-model";
import { DEFAULT_BRANCHES } from "./fake-gateway";
import type { VcsBranch } from "./vcs-schemas";

function branch(name: string, remote = false): VcsBranch {
  return { name, remote, current: false, upstream: null };
}

describe("groupBranches", () => {
  test("lists local branches and the remote ones that have no local branch of that name", () => {
    const { local, remote } = groupBranches(DEFAULT_BRANCHES, "");
    expect(local.map((entry) => entry.name)).toEqual(["main", "dev"]);
    expect(remote.map((entry) => entry.name)).toEqual(["origin/feature"]);
  });

  test("hides the remote HEAD pointer", () => {
    const { remote } = groupBranches([branch("origin/HEAD", true), branch("origin/x", true)], "");
    expect(remote.map((entry) => entry.name)).toEqual(["origin/x"]);
  });

  test("a branch with slashes keeps them: only the remote name is stripped for the comparison", () => {
    const branches = [branch("feature/a"), branch("origin/feature/a", true), branch("origin/feature/b", true)];
    expect(groupBranches(branches, "").remote.map((entry) => entry.name)).toEqual(["origin/feature/b"]);
  });

  test("filters both lists by a case-insensitive substring", () => {
    const { local, remote } = groupBranches(DEFAULT_BRANCHES, " FEAT ");
    expect(local).toEqual([]);
    expect(remote.map((entry) => entry.name)).toEqual(["origin/feature"]);
  });
});

describe("branchNameProblem", () => {
  const branches = [branch("main"), branch("origin/dev", true)];

  test("accepts ordinary names, with slashes and dots inside", () => {
    for (const name of ["feature/login", "fix-1", "v1.2.3", "dev", "  padded  "]) {
      expect(branchNameProblem(name, branches)).toBeNull();
    }
  });

  test("asks for a name when it is empty", () => {
    expect(branchNameProblem("   ", branches)).toContain("Enter a name");
  });

  test("refuses names git refuses", () => {
    for (const name of ["a b", "a~1", "a^", "a:b", "a?", "a*", "a[", "a\\b", "-x", "/x", "x/", "a..b", "a//b", "a@{b", "x.", "x.lock", "@"]) {
      expect(branchNameProblem(name, branches)).not.toBeNull();
    }
  });

  test("refuses a name a local branch already has, but not one only a remote branch has", () => {
    expect(branchNameProblem("main", branches)).toBe("A branch named main already exists");
    expect(branchNameProblem("origin/dev", branches)).toBeNull();
  });
});

describe("switchTargetLabel", () => {
  test("says a remote branch gets a tracking local branch", () => {
    expect(switchTargetLabel(branch("origin/x", true))).toContain("tracks origin/x");
    expect(switchTargetLabel(branch("x"))).toBe("Switch to this branch");
  });
});
