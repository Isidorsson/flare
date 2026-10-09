import { branchNameProblem } from "./branch-model";
import { reconcileSelection } from "./change-groups";
import { buildCommitMessage, EMPTY_DRAFT } from "./commit-draft";
import { withError, withoutError } from "./error-state";
import { INITIAL_PR } from "./pr-model";
import { PrController } from "./pr-controller";
import { createPrBlockedReason } from "./pr-selectors";
import { describeVcsError } from "./vcs-errors";
import type { VcsGateway } from "./vcs-gateway";
import type { FileDiff, VcsStatus } from "./vcs-schemas";
import {
  actionBlockedReason,
  commitAndPushBlockedReason,
  commitBlockedReason,
  draftOf,
  generateBlockedReason,
  pullBlockedReason,
  pushBlockedReason,
} from "./vcs-selectors";
import type {
  CommitDraft,
  CommitMessageGenerator,
  DiffState,
  FileSelection,
  MutatingAction,
  PullRequestGenerator,
  StoreAccess,
  VcsAction,
  VcsSnapshot,
} from "./vcs-types";

export interface VcsDeps {
  gateway: VcsGateway;
}

const IDLE_DIFF: DiffState = { kind: "idle" };

export const INITIAL_SNAPSHOT: VcsSnapshot = {
  root: null,
  status: null,
  branches: [],
  branchesLoading: false,
  selection: null,
  diff: IDLE_DIFF,
  drafts: {},
  busy: null,
  generating: false,
  canGenerate: false,
  pr: INITIAL_PR,
  prDrafts: {},
  prExpanded: false,
  generatingPr: false,
  canGeneratePr: false,
  errors: {},
};

const ROOT_SCOPED: Partial<VcsSnapshot> = {
  status: null,
  branches: [],
  branchesLoading: false,
  selection: null,
  diff: IDLE_DIFF,
  busy: null,
  generating: false,
  pr: INITIAL_PR,
  generatingPr: false,
  errors: {},
};

type Guard = (snapshot: VcsSnapshot) => string | null;

// The same functions disable the buttons, so what the UI offers and what the controller accepts cannot drift apart.
const GUARDS: Record<MutatingAction, Guard> = {
  stage: actionBlockedReason,
  unstage: actionBlockedReason,
  discard: actionBlockedReason,
  commit: commitBlockedReason,
  commitAndPush: commitAndPushBlockedReason,
  fetch: actionBlockedReason,
  pull: pullBlockedReason,
  push: pushBlockedReason,
  switchBranch: actionBlockedReason,
  createBranch: actionBlockedReason,
  deleteBranch: actionBlockedReason,
  createPr: createPrBlockedReason,
};

function sameDiff(a: FileDiff, b: FileDiff): boolean {
  return a.path === b.path && a.binary === b.binary && a.original === b.original && a.modified === b.modified;
}

/**
 * Keeps a repository's status, the selected file's diff and the commit draft, and runs the git actions
 * against a gateway. Every action ends in the snapshot (an error under its action name, never a throw),
 * and an answer that arrives after the workspace changed is dropped.
 */
export class VcsController {
  readonly #gateway: VcsGateway;
  readonly #store: StoreAccess;
  readonly #pr: PrController;
  #generate: CommitMessageGenerator | null = null;
  #epoch = 0;
  #statusTicket = 0;
  #diffTicket = 0;
  #branchTicket = 0;
  #revision = 0;

  constructor(deps: VcsDeps, store: StoreAccess) {
    this.#gateway = deps.gateway;
    this.#store = store;
    this.#pr = new PrController(
      {
        gateway: deps.gateway,
        host: { mutate: (action, run) => this.#mutate(action, run), loadBranches: () => this.loadBranches() },
      },
      store,
    );
  }

  configure(generate: CommitMessageGenerator): void {
    this.#generate = generate;
    this.#store.set(() => ({ canGenerate: true }));
  }

  configurePullRequest(generate: PullRequestGenerator): void {
    this.#pr.configure(generate);
  }

  setRoot(root: string | null): Promise<void> {
    if (this.#store.get().root === root) return Promise.resolve();
    this.#pr.reset();
    this.#epoch += 1;
    this.#statusTicket += 1;
    this.#diffTicket += 1;
    this.#branchTicket += 1;
    this.#store.set(() => ({ ...ROOT_SCOPED, root }));
    return this.refresh();
  }

  async refresh(): Promise<void> {
    const { root } = this.#store.get();
    if (root === null) return;
    const epoch = this.#epoch;
    this.#statusTicket += 1;
    const ticket = this.#statusTicket;
    try {
      const status = await this.#gateway.status({ root });
      if (epoch === this.#epoch && ticket === this.#statusTicket) this.#applyStatus(status);
    } catch (error) {
      if (epoch === this.#epoch && ticket === this.#statusTicket) this.#fail("refresh", error);
    }
  }

  /** Refresh for a person asking: the git status and what GitHub says, which plain refreshes leave alone. */
  async reload(): Promise<void> {
    await this.refresh();
    await this.#pr.loadInfo();
  }

  selectFile(selection: FileSelection | null): Promise<void> {
    this.#diffTicket += 1;
    if (selection === null) {
      this.#store.set(() => ({ selection: null, diff: IDLE_DIFF }));
      return Promise.resolve();
    }
    this.#store.set(() => ({ selection, diff: { kind: "loading" } }));
    return this.#fetchDiff(selection);
  }

  async stage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.#mutate("stage", (root) => this.#gateway.stage({ root, paths }));
  }

  /** Empty paths mean everything to the gateway, which also copes with more files than a command line can name. */
  async stageAll(): Promise<void> {
    await this.#mutate("stage", (root) => this.#gateway.stage({ root, paths: [] }));
  }

  async unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.#mutate("unstage", (root) => this.#gateway.unstage({ root, paths }));
  }

  async unstageAll(): Promise<void> {
    await this.#mutate("unstage", (root) => this.#gateway.unstage({ root, paths: [] }));
  }

  /** Never called with an empty list: for a discard that is an invalid request, not "everything". */
  async discard(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.#mutate("discard", (root) => this.#gateway.discard({ root, paths }));
  }

  async fetch(): Promise<void> {
    await this.#mutate("fetch", (root) => this.#gateway.fetch({ root }));
  }

  async pull(): Promise<void> {
    await this.#mutate("pull", (root) => this.#gateway.pull({ root }));
  }

  async push(): Promise<void> {
    const pushed = await this.#mutate("push", (root) => this.#gateway.push({ root }));
    if (pushed) await this.#pr.loadInfo();
  }

  async commit(): Promise<void> {
    await this.#mutate("commit", (root) => this.#commitTo(root));
  }

  async commitAndPush(): Promise<void> {
    const pushed = await this.#mutate("commitAndPush", async (root) => {
      await this.#commitTo(root);
      try {
        return await this.#gateway.push({ root });
      } catch (error) {
        throw new Error(`Committed, but pushing failed: ${describeVcsError(error)}`, { cause: error });
      }
    });
    if (pushed) await this.#pr.loadInfo();
  }

  async loadBranches(): Promise<void> {
    const { root } = this.#store.get();
    if (root === null) return;
    const epoch = this.#epoch;
    this.#branchTicket += 1;
    const ticket = this.#branchTicket;
    this.#store.set((state) => ({ branchesLoading: true, errors: withoutError(state.errors, "branches") }));
    try {
      const branches = await this.#gateway.branches({ root });
      if (epoch === this.#epoch && ticket === this.#branchTicket) this.#store.set(() => ({ branches }));
    } catch (error) {
      if (epoch === this.#epoch && ticket === this.#branchTicket) this.#fail("branches", error);
    } finally {
      if (epoch === this.#epoch && ticket === this.#branchTicket) this.#store.set(() => ({ branchesLoading: false }));
    }
  }

  async switchBranch(name: string): Promise<void> {
    const switched = await this.#mutate("switchBranch", (root) => this.#gateway.switchBranch({ root, name }));
    if (switched) await this.loadBranches();
  }

  async createBranch(name: string): Promise<void> {
    const trimmed = name.trim();
    const problem = branchNameProblem(trimmed, this.#store.get().branches);
    if (problem !== null) {
      this.#fail("createBranch", new Error(problem));
      return;
    }
    const created = await this.#mutate("createBranch", (root) => this.#gateway.createBranch({ root, name: trimmed }));
    if (created) await this.loadBranches();
  }

  async deleteBranch(name: string, force: boolean): Promise<void> {
    const deleted = await this.#mutate("deleteBranch", (root) => this.#gateway.deleteBranch({ root, name, force }));
    if (deleted) await this.loadBranches();
  }

  async generateMessage(): Promise<void> {
    const generate = this.#generate;
    const state = this.#store.get();
    if (generate === null || state.root === null || generateBlockedReason(state) !== null) return;
    const { root } = state;
    const { includeBody } = draftOf(state);
    const epoch = this.#epoch;
    this.#store.set((current) => ({ generating: true, errors: withoutError(current.errors, "generate") }));
    try {
      const context = await this.#gateway.messageContext({ root });
      const { subject, body } = await generate({
        stat: context.stat,
        patch: context.patch,
        truncated: context.truncated,
        recentSubjects: context.recentSubjects,
        recentBodies: context.recentBodies,
        branch: context.branch,
        includeBody,
      });
      if (epoch !== this.#epoch) return;
      this.#patchDraft(root, { subject: subject.trim(), ...(body === null ? {} : { description: body.trim() }) });
    } catch (error) {
      if (epoch === this.#epoch) this.#fail("generate", error);
    } finally {
      if (epoch === this.#epoch) this.#store.set(() => ({ generating: false }));
    }
  }

  setSubject(subject: string): void {
    this.#patchCurrentDraft({ subject });
  }

  setDescription(description: string): void {
    this.#patchCurrentDraft({ description });
  }

  setIncludeBody(includeBody: boolean): void {
    this.#patchCurrentDraft({ includeBody });
  }

  loadPrInfo(): Promise<void> {
    return this.#pr.loadInfo();
  }

  setPrExpanded(expanded: boolean): Promise<void> {
    return this.#pr.setExpanded(expanded);
  }

  generatePr(): Promise<void> {
    return this.#pr.generate();
  }

  createPr(): Promise<void> {
    return this.#pr.create();
  }

  setPrBase(base: string): void {
    this.#pr.setBase(base);
  }

  setPrTitle(title: string): void {
    this.#pr.setTitle(title);
  }

  setPrBody(body: string): void {
    this.#pr.setBody(body);
  }

  setPrDraft(isDraft: boolean): void {
    this.#pr.setDraft(isDraft);
  }

  dismissError(action: VcsAction): void {
    this.#store.set((state) => ({ errors: withoutError(state.errors, action) }));
  }

  async #commitTo(root: string): Promise<VcsStatus> {
    const message = buildCommitMessage(draftOf(this.#store.get()));
    const result = await this.#gateway.commit({ root, message });
    this.#patchDraft(root, { subject: "", description: "" });
    return result.status;
  }

  async #mutate(action: MutatingAction, run: (root: string) => Promise<VcsStatus>): Promise<boolean> {
    const state = this.#store.get();
    if (state.root === null || GUARDS[action](state) !== null) return false;
    const { root } = state;
    const epoch = this.#epoch;
    this.#store.set((current) => ({ busy: action, errors: withoutError(current.errors, action) }));
    try {
      const status = await run(root);
      if (epoch !== this.#epoch) return false;
      this.#applyStatus(status);
      return true;
    } catch (error) {
      if (epoch !== this.#epoch) return false;
      this.#fail(action, error);
      await this.refresh();
      return false;
    } finally {
      if (epoch === this.#epoch) this.#store.set(() => ({ busy: null }));
    }
  }

  #applyStatus(status: VcsStatus): void {
    this.#statusTicket += 1;
    const selection = reconcileSelection(this.#store.get().selection, status.files);
    this.#store.set((state) => ({
      status,
      selection,
      errors: withoutError(state.errors, "refresh"),
      ...(selection === null ? { diff: IDLE_DIFF } : {}),
    }));
    if (selection !== null) void this.#fetchDiff(selection);
    this.#pr.statusApplied(status);
  }

  async #fetchDiff(selection: FileSelection): Promise<void> {
    const { root } = this.#store.get();
    if (root === null) return;
    const epoch = this.#epoch;
    this.#diffTicket += 1;
    const ticket = this.#diffTicket;
    try {
      const diff = await this.#gateway.fileDiff({ root, path: selection.path, staged: selection.staged });
      if (epoch !== this.#epoch || ticket !== this.#diffTicket) return;
      this.#store.set((state) => ({ diff: this.#nextDiff(state.diff, diff) }));
    } catch (error) {
      if (epoch === this.#epoch && ticket === this.#diffTicket) {
        this.#store.set(() => ({ diff: { kind: "error", message: describeVcsError(error) } }));
      }
    }
  }

  #nextDiff(previous: DiffState, diff: FileDiff): DiffState {
    if (previous.kind === "ready" && sameDiff(previous.diff, diff)) return previous;
    this.#revision += 1;
    return { kind: "ready", diff, revision: this.#revision };
  }

  #patchCurrentDraft(patch: Partial<CommitDraft>): void {
    const { root } = this.#store.get();
    if (root !== null) this.#patchDraft(root, patch);
  }

  #patchDraft(root: string, patch: Partial<CommitDraft>): void {
    this.#store.set((state) => ({
      drafts: { ...state.drafts, [root]: { ...(state.drafts[root] ?? EMPTY_DRAFT), ...patch } },
    }));
  }

  #fail(action: VcsAction, error: unknown): void {
    const message = describeVcsError(error);
    this.#store.set((state) => ({ errors: withError(state.errors, action, message) }));
  }
}
