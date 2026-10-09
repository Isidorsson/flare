import { withError, withoutError } from "./error-state";
import { EMPTY_PR_DRAFT, prDraftKey } from "./pr-model";
import { currentBranchOf, generatePrBlockedReason, prDraftOf, prTarget, prViewKind, type PrTarget } from "./pr-selectors";
import type { PrDraft } from "./pr-types";
import { describeVcsError } from "./vcs-errors";
import type { VcsGateway } from "./vcs-gateway";
import { VcsCommandError, type PrCreateResult, type PullRequest, type VcsStatus } from "./vcs-schemas";
import type { MutatingAction, PullRequestGenerator, StoreAccess, VcsAction } from "./vcs-types";

/** What the pull request side needs from the rest of the controller. */
export interface PrHost {
  /** Runs a git action under the one-at-a-time rule; answers whether it succeeded. */
  mutate: (action: MutatingAction, run: (root: string) => Promise<VcsStatus>) => Promise<boolean>;
  loadBranches: () => Promise<void>;
}

export interface PrDeps {
  gateway: VcsGateway;
  host: PrHost;
}

interface Loading {
  branch: string;
  ticket: number;
  promise: Promise<void>;
}

/**
 * Keeps what GitHub says about the current branch and the pull request being written. `gh` is asked
 * once per branch (when the folder opens or the branch changes) and again only on request, never on a
 * plain status refresh, so file changes do not turn into network calls.
 */
export class PrController {
  readonly #gateway: VcsGateway;
  readonly #host: PrHost;
  readonly #store: StoreAccess;
  #generate: PullRequestGenerator | null = null;
  #epoch = 0;
  #ticket = 0;
  #requested: string | null = null;
  #loading: Loading | null = null;

  constructor(deps: PrDeps, store: StoreAccess) {
    this.#gateway = deps.gateway;
    this.#host = deps.host;
    this.#store = store;
  }

  configure(generate: PullRequestGenerator): void {
    this.#generate = generate;
    this.#store.set(() => ({ canGeneratePr: true }));
  }

  /** The folder changed: whatever was asked about the old one no longer counts. */
  reset(): void {
    this.#epoch += 1;
    this.#ticket += 1;
    this.#requested = null;
    this.#loading = null;
  }

  /** Called with every fresh status: asks `gh` only when the branch is one it has not been asked about. */
  statusApplied(status: VcsStatus): void {
    const { root } = this.#store.get();
    if (root === null || !status.isRepo || status.branch === null || status.branch === this.#requested) return;
    void this.#load(root, status.branch);
  }

  /** Asks `gh` about the current branch again. A question already on its way is reused. */
  loadInfo(): Promise<void> {
    const { root, status } = this.#store.get();
    if (root === null || status?.isRepo !== true || status.branch === null) return Promise.resolve();
    return this.#load(root, status.branch);
  }

  async generate(): Promise<void> {
    const generate = this.#generate;
    const state = this.#store.get();
    const target = prTarget(state);
    if (generate === null || target === null || generatePrBlockedReason(state) !== null) return;
    const epoch = this.#epoch;
    this.#store.set((current) => ({ generatingPr: true, errors: withoutError(current.errors, "generatePr") }));
    try {
      const context = await this.#gateway.prContext({ root: target.root, base: target.base });
      if (epoch !== this.#epoch) return;
      this.#recordAhead(target, context.commits.length);
      if (context.commits.length === 0) {
        throw new VcsCommandError("no_commits", `${target.branch} has no commits ahead of ${target.base}`);
      }
      const { title, body } = await generate({
        branch: context.branch,
        base: context.base,
        commits: context.commits,
        stat: context.stat,
        truncated: context.truncated,
      });
      if (epoch === this.#epoch) this.#patchDraft(target, { title: title.trim(), body: body.trim() });
    } catch (error) {
      if (epoch === this.#epoch) this.#fail("generatePr", error);
    } finally {
      if (epoch === this.#epoch) this.#store.set(() => ({ generatingPr: false }));
    }
  }

  async create(): Promise<void> {
    const state = this.#store.get();
    const target = prTarget(state);
    if (target === null) return;
    const draft = prDraftOf(state);
    const epoch = this.#epoch;
    const created: { pr: PullRequest | null } = { pr: null };
    const done = await this.#host.mutate("createPr", async () => {
      const result = await this.#submit(target, draft);
      created.pr = result.pr;
      return result.status;
    });
    if (done && created.pr !== null && epoch === this.#epoch) this.#showCreated(target, created.pr);
  }

  /** Opening the section lists the branches for the base picker: it is needed only there. */
  async setExpanded(expanded: boolean): Promise<void> {
    this.#store.set(() => ({ prExpanded: expanded }));
    if (expanded && prViewKind(this.#store.get()) === "form") await this.#host.loadBranches();
  }

  setBase(base: string): void {
    this.#patchCurrent({ base });
  }

  setTitle(title: string): void {
    this.#patchCurrent({ title });
  }

  setBody(body: string): void {
    this.#patchCurrent({ body });
  }

  setDraft(isDraft: boolean): void {
    this.#patchCurrent({ isDraft });
  }

  #load(root: string, branch: string): Promise<void> {
    if (this.#loading?.branch === branch) return this.#loading.promise;
    this.#requested = branch;
    this.#ticket += 1;
    const ticket = this.#ticket;
    const promise = this.#read(root, branch, ticket);
    this.#loading = { branch, ticket, promise };
    return promise;
  }

  async #read(root: string, branch: string, ticket: number): Promise<void> {
    const current = () => ticket === this.#ticket;
    this.#store.set((state) => ({ pr: { ...state.pr, loading: true }, errors: withoutError(state.errors, "loadPr") }));
    try {
      const info = await this.#gateway.prInfo({ root });
      if (!current()) return;
      this.#store.set((state) => ({ pr: { ...state.pr, info, branch, loading: false } }));
      if (this.#wantsBranches()) await this.#host.loadBranches();
    } catch (error) {
      if (!current()) return;
      this.#store.set((state) => ({
        pr: { ...state.pr, loading: false },
        errors: withError(state.errors, "loadPr", describeVcsError(error)),
      }));
    } finally {
      if (this.#loading?.ticket === ticket) this.#loading = null;
    }
  }

  /** A section that was opened before the form was ready still needs the branches for its base picker. */
  #wantsBranches(): boolean {
    const state = this.#store.get();
    const unlisted = state.branches.length === 0 && !state.branchesLoading;
    return state.prExpanded && unlisted && prViewKind(state) === "form";
  }

  async #submit(target: PrTarget, draft: PrDraft): Promise<PrCreateResult> {
    try {
      return await this.#gateway.prCreate({
        root: target.root,
        title: draft.title.trim(),
        body: draft.body.trim(),
        base: target.base,
        draft: draft.isDraft,
      });
    } catch (error) {
      if (error instanceof VcsCommandError && error.code === "no_commits") this.#recordAhead(target, 0);
      throw error;
    }
  }

  #showCreated(target: PrTarget, pr: PullRequest): void {
    this.#store.set((state) => ({
      pr: state.pr.info === null ? state.pr : { ...state.pr, info: { ...state.pr.info, current: pr }, branch: target.branch },
    }));
    this.#patchDraft(target, { title: "", body: "" });
  }

  #recordAhead(target: PrTarget, commits: number): void {
    const { branch, base, head } = target;
    this.#store.set((state) => ({ pr: { ...state.pr, ahead: { branch, base, head, commits } } }));
  }

  #patchCurrent(patch: Partial<PrDraft>): void {
    const state = this.#store.get();
    const branch = currentBranchOf(state);
    if (state.root !== null && branch !== null) this.#patchDraft({ root: state.root, branch }, patch);
  }

  #patchDraft(where: { root: string; branch: string }, patch: Partial<PrDraft>): void {
    const key = prDraftKey(where.root, where.branch);
    this.#store.set((state) => ({
      prDrafts: { ...state.prDrafts, [key]: { ...(state.prDrafts[key] ?? EMPTY_PR_DRAFT), ...patch } },
    }));
  }

  #fail(action: VcsAction, error: unknown): void {
    const message = describeVcsError(error);
    this.#store.set((state) => ({ errors: withError(state.errors, action, message) }));
  }
}
