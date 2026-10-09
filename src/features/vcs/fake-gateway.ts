import { DEFAULT_PR_INFO, modelPrGateway, recordPrCalls, type PrFakeOptions } from "./fake-pr-gateway";
import type { VcsGateway } from "./vcs-gateway";
import {
  VcsCommandError,
  type Change,
  type FileDiff,
  type MessageContext,
  type PrInfo,
  type VcsBranch,
  type VcsFile,
  type VcsStatus,
} from "./vcs-schemas";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export function deferred<T>(): Deferred<T> {
  const handlers: Pick<Deferred<T>, "resolve" | "reject"> = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<T>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  return { promise, ...handlers };
}

export function file(
  path: string,
  staged: Change | null,
  unstaged: Change | null,
  origPath: string | null = null,
): VcsFile {
  return { path, origPath, staged, unstaged };
}

export function repoStatus(overrides: Partial<VcsStatus> = {}): VcsStatus {
  return {
    isRepo: true,
    branch: "main",
    head: "abc1234",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    files: [],
    ...overrides,
  };
}

export const NOT_A_REPO: VcsStatus = {
  isRepo: false,
  branch: null,
  head: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
};

export function textDiff(path: string, original: string | null, modified: string | null): FileDiff {
  return { path, original, modified, binary: false };
}

export const DEFAULT_CONTEXT: MessageContext = {
  source: "staged",
  stat: " src/a.ts | 2 +-",
  patch: "diff --git a/src/a.ts b/src/a.ts\n-old\n+new",
  truncated: false,
  recentSubjects: ["feat(files): open diffs"],
  branch: "main",
  recentBodies: ["Reviewing a change needs the two versions side by side."],
};

export interface FakeRepo {
  status: VcsStatus;
  branches: VcsBranch[];
  pr: PrInfo;
}

export interface FakeGateway {
  gateway: VcsGateway;
  /** One line per git call, in order, e.g. "stage src/a.ts" or "switch dev". */
  calls: string[];
  /** One line per `gh` call (pull request commands), in order, e.g. "prInfo". */
  ghCalls: string[];
  /** The repository the fake models; changes as the gateway is used. */
  repo: FakeRepo;
}

export interface FakeOptions extends PrFakeOptions {
  status?: VcsStatus;
  branches?: VcsBranch[];
  diffs?: Record<string, FileDiff>;
  context?: MessageContext;
  prInfo?: PrInfo;
  overrides?: Partial<VcsGateway>;
}

export const DEFAULT_BRANCHES: VcsBranch[] = [
  { name: "main", remote: false, current: true, upstream: "origin/main" },
  { name: "dev", remote: false, current: false, upstream: null },
  { name: "origin/main", remote: true, current: false, upstream: null },
  { name: "origin/feature", remote: true, current: false, upstream: null },
];

function stagedKind(file: VcsFile): Change {
  return file.unstaged === "untracked" ? "added" : (file.unstaged ?? "modified");
}

function stageFile(file: VcsFile): VcsFile {
  return file.unstaged === null ? file : { ...file, staged: stagedKind(file), unstaged: null };
}

function unstageFile(file: VcsFile): VcsFile {
  if (file.staged === null) return file;
  return { ...file, staged: null, unstaged: file.staged === "added" ? "untracked" : file.staged };
}

function discardFile(file: VcsFile): VcsFile {
  return file.unstaged === null || file.unstaged === "untracked" ? file : { ...file, unstaged: null };
}

/** Like the real commands, an empty list of paths means every file. */
function changedFile(paths: string[], update: (file: VcsFile) => VcsFile) {
  return (status: VcsStatus): VcsStatus => ({
    ...status,
    files: status.files
      .map((candidate) => (paths.length === 0 || paths.includes(candidate.path) ? update(candidate) : candidate))
      .filter((candidate) => candidate.staged !== null || candidate.unstaged !== null),
  });
}

function switchedTo(branches: VcsBranch[], name: string): VcsBranch[] {
  return branches.map((branch) => ({ ...branch, current: !branch.remote && branch.name === name }));
}

type GitGateway = Omit<VcsGateway, "prInfo" | "prContext" | "prCreate">;

function modelGateway(repo: FakeRepo, options: FakeOptions): GitGateway {
  const mutate = (update: (status: VcsStatus) => VcsStatus): Promise<VcsStatus> => {
    repo.status = update(repo.status);
    return Promise.resolve(repo.status);
  };

  return {
    status: () => Promise.resolve(repo.status),
    fileDiff: ({ path, staged }) => {
      const diff = options.diffs?.[`${staged ? "staged" : "unstaged"}:${path}`];
      return Promise.resolve(diff ?? textDiff(path, "old\n", "new\n"));
    },
    stage: ({ paths }) => mutate(changedFile(paths, stageFile)),
    unstage: ({ paths }) => mutate(changedFile(paths, unstageFile)),
    discard: ({ paths }) =>
      paths.length === 0
        ? Promise.reject(new VcsCommandError("invalid_request", "discard needs at least one path"))
        : mutate(changedFile(paths, discardFile)),
    commit: async () => {
      const status = await mutate((current) => ({
        ...current,
        ahead: current.ahead + 1,
        files: current.files
          .map((candidate) => ({ ...candidate, staged: null }))
          .filter((candidate) => candidate.unstaged !== null),
      }));
      return { commit: "def5678", summary: "1 file changed", status };
    },
    branches: () => Promise.resolve(repo.branches),
    createBranch: ({ name }) => {
      repo.branches = [...switchedTo(repo.branches, name), { name, remote: false, current: true, upstream: null }];
      return mutate((current) => ({ ...current, branch: name, upstream: null }));
    },
    switchBranch: ({ name }) => {
      repo.branches = switchedTo(repo.branches, name);
      return mutate((current) => ({ ...current, branch: name }));
    },
    deleteBranch: ({ name }) => {
      repo.branches = repo.branches.filter((branch) => branch.remote || branch.name !== name);
      return Promise.resolve(repo.status);
    },
    fetch: () => Promise.resolve(repo.status),
    pull: () => mutate((current) => ({ ...current, behind: 0 })),
    push: () => mutate((current) => ({ ...current, ahead: 0, upstream: current.upstream ?? `origin/${current.branch ?? ""}` })),
    messageContext: () => Promise.resolve(options.context ?? DEFAULT_CONTEXT),
  };
}

function listed(paths: string[]): string {
  return paths.length === 0 ? "(all)" : paths.join(",");
}

function recordGitCalls(calls: string[], pick: <K extends keyof VcsGateway>(name: K) => VcsGateway[K]): GitGateway {
  return {
    status: (request) => {
      calls.push("status");
      return pick("status")(request);
    },
    fileDiff: (request) => {
      calls.push(`diff ${request.staged ? "staged" : "unstaged"} ${request.path}`);
      return pick("fileDiff")(request);
    },
    stage: (request) => {
      calls.push(`stage ${listed(request.paths)}`);
      return pick("stage")(request);
    },
    unstage: (request) => {
      calls.push(`unstage ${listed(request.paths)}`);
      return pick("unstage")(request);
    },
    discard: (request) => {
      calls.push(`discard ${listed(request.paths)}`);
      return pick("discard")(request);
    },
    commit: (request) => {
      calls.push(`commit ${JSON.stringify(request.message)}`);
      return pick("commit")(request);
    },
    branches: (request) => {
      calls.push("branches");
      return pick("branches")(request);
    },
    createBranch: (request) => {
      calls.push(`create ${request.name}`);
      return pick("createBranch")(request);
    },
    switchBranch: (request) => {
      calls.push(`switch ${request.name}`);
      return pick("switchBranch")(request);
    },
    deleteBranch: (request) => {
      calls.push(`delete ${request.name} force=${String(request.force)}`);
      return pick("deleteBranch")(request);
    },
    fetch: (request) => {
      calls.push("fetch");
      return pick("fetch")(request);
    },
    pull: (request) => {
      calls.push("pull");
      return pick("pull")(request);
    },
    push: (request) => {
      calls.push("push");
      return pick("push")(request);
    },
    messageContext: (request) => {
      calls.push("messageContext");
      return pick("messageContext")(request);
    },
  };
}

/**
 * A gateway that models a small repository: staging, committing, switching and pushing change the
 * status it answers with. Pass `overrides` to script failures or calls that stay pending.
 */
export function createFakeGateway(options: FakeOptions = {}): FakeGateway {
  const calls: string[] = [];
  const ghCalls: string[] = [];
  const repo: FakeRepo = {
    status: options.status ?? repoStatus(),
    branches: options.branches ?? DEFAULT_BRANCHES,
    pr: options.prInfo ?? DEFAULT_PR_INFO,
  };
  const model: VcsGateway = { ...modelGateway(repo, options), ...modelPrGateway(repo, options) };
  const overrides = options.overrides ?? {};
  const pick = <K extends keyof VcsGateway>(name: K): VcsGateway[K] => overrides[name] ?? model[name];
  return { gateway: { ...recordGitCalls(calls, pick), ...recordPrCalls(ghCalls, pick) }, calls, ghCalls, repo };
}
