import type { VcsBranch } from "./vcs-schemas";

export interface BranchGroups {
  local: VcsBranch[];
  remote: VcsBranch[];
}

const FORBIDDEN_CHARACTERS = /[\s~^:?*[\\]/;

function remoteBaseName(name: string): string {
  return name.slice(name.indexOf("/") + 1);
}

/**
 * Local branches, then the remote ones that have no local branch of the same name yet (switching to
 * one of those creates the tracking branch). `filter` narrows both by a case-insensitive substring.
 */
export function groupBranches(branches: readonly VcsBranch[], filter: string): BranchGroups {
  const needle = filter.trim().toLowerCase();
  const matches = (branch: VcsBranch) => branch.name.toLowerCase().includes(needle);
  const local = branches.filter((branch) => !branch.remote);
  const localNames = new Set(local.map((branch) => branch.name));
  const remote = branches.filter(
    (branch) => branch.remote && !branch.name.endsWith("/HEAD") && !localNames.has(remoteBaseName(branch.name)),
  );
  return { local: local.filter(matches), remote: remote.filter(matches) };
}

interface NameRule {
  broken: (name: string) => boolean;
  message: string;
}

const NAME_RULES: readonly NameRule[] = [
  {
    broken: (name) => FORBIDDEN_CHARACTERS.test(name),
    message: "Branch names cannot contain spaces or any of ~ ^ : ? * [ \\",
  },
  {
    broken: (name) => /^[-/]|\/$/.test(name),
    message: "A branch name cannot start with - or start or end with /",
  },
  {
    broken: (name) => /\.\.|\/\/|@\{/.test(name),
    message: "A branch name cannot contain .. or // or @{",
  },
  {
    broken: (name) => /\.$|\.lock$/.test(name) || name === "@",
    message: "A branch name cannot end with . or .lock, or be @",
  },
];

/** Why `name` cannot be a new branch (the common cases of git's ref-name rules), or null. Git still has the last word. */
export function branchNameProblem(name: string, branches: readonly VcsBranch[]): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter a name for the new branch";
  const broken = NAME_RULES.find((rule) => rule.broken(trimmed));
  if (broken !== undefined) return broken.message;
  const taken = branches.some((branch) => !branch.remote && branch.name === trimmed);
  return taken ? `A branch named ${trimmed} already exists` : null;
}

export function switchTargetLabel(branch: VcsBranch): string {
  return branch.remote ? `Create a local branch that tracks ${branch.name} and switch to it` : "Switch to this branch";
}
