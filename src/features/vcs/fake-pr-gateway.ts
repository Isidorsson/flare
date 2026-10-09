import type { FakeRepo } from "./fake-gateway";
import type { VcsGateway } from "./vcs-gateway";
import { VcsCommandError, type PrContext, type PrInfo, type PullRequest } from "./vcs-schemas";

export type PrGateway = Pick<VcsGateway, "prInfo" | "prContext" | "prCreate">;

export const DEFAULT_PR_INFO: PrInfo = {
  ghAvailable: true,
  authenticated: true,
  defaultBase: "main",
  current: null,
};

export const DEFAULT_PR_CONTEXT: PrContext = {
  base: "main",
  branch: "feat/login",
  commits: [
    { subject: "feat(auth): add the login form", body: "" },
    { subject: "fix(auth): trim the email", body: "Pasted addresses carried a trailing space." },
  ],
  stat: " src/login.ts | 40 ++++++++\n 1 file changed, 40 insertions(+)",
  truncated: false,
};

export function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    url: "https://github.com/acme/app/pull/42",
    title: "feat(auth): add login",
    state: "open",
    isDraft: false,
    base: "main",
    ...overrides,
  };
}

export interface PrFakeOptions {
  prContext?: PrContext;
}

/** Like the real commands, creating pushes the branch first and refuses a branch that is not ahead of its base. */
export function modelPrGateway(repo: FakeRepo, options: PrFakeOptions): PrGateway {
  const contextFor = (base: string): PrContext => ({
    ...(options.prContext ?? DEFAULT_PR_CONTEXT),
    base,
    branch: repo.status.branch ?? "HEAD",
  });

  return {
    prInfo: () => Promise.resolve(repo.pr),
    prContext: ({ base }) => Promise.resolve(contextFor(base)),
    prCreate: ({ title, base, draft }) => {
      const { branch, upstream } = repo.status;
      if (branch === base) return Promise.reject(new VcsCommandError("on_base_branch", "on the base branch"));
      if (contextFor(base).commits.length === 0) return Promise.reject(new VcsCommandError("no_commits", "nothing ahead"));
      repo.status = { ...repo.status, ahead: 0, upstream: upstream ?? `origin/${branch ?? ""}` };
      const pr = pullRequest({ title, base, isDraft: draft });
      repo.pr = { ...repo.pr, current: pr };
      return Promise.resolve({ pr, status: repo.status });
    },
  };
}

/** Records the `gh` calls apart from the git ones, so a plain status refresh can be shown to cost no network call. */
export function recordPrCalls(calls: string[], pick: <K extends keyof PrGateway>(name: K) => PrGateway[K]): PrGateway {
  return {
    prInfo: (request) => {
      calls.push("prInfo");
      return pick("prInfo")(request);
    },
    prContext: (request) => {
      calls.push(`prContext ${request.base}`);
      return pick("prContext")(request);
    },
    prCreate: (request) => {
      calls.push(`prCreate ${request.base} draft=${String(request.draft)} ${JSON.stringify(request.title)}`);
      return pick("prCreate")(request);
    },
  };
}
