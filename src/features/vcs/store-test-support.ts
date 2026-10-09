import { createFakeGateway, file, repoStatus, type FakeOptions } from "./fake-gateway";
import { createVcsStore } from "./vcs-store";
import type { CommitMessageGenerator, CommitMessageInput, PullRequestGenerator, PullRequestInput } from "./vcs-types";

export const ROOT = "C:/work/app";
export const OTHER_ROOT = "C:/work/other";

export const WORKTREE = repoStatus({
  files: [file("src/a.ts", null, "modified"), file("notes.md", null, "untracked"), file("src/b.ts", "modified", null)],
});

export function setup(options: FakeOptions = {}) {
  const fake = createFakeGateway({ status: WORKTREE, ...options });
  const store = createVcsStore({ gateway: fake.gateway });
  return { ...fake, store, state: () => store.getState() };
}

/** A store whose root has been opened, so the first status is in. */
export async function opened(options: FakeOptions = {}) {
  const harness = setup(options);
  await harness.store.getState().setRoot(ROOT);
  return harness;
}

export function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A message generator that records what it was asked; with `includeBody` off it answers without a body. */
export function generator(reply: { subject: string; body: string | null } = { subject: "feat(files): add diffs", body: "Why." }) {
  const inputs: CommitMessageInput[] = [];
  const generate: CommitMessageGenerator = (input) => {
    inputs.push(input);
    return Promise.resolve(input.includeBody ? reply : { subject: reply.subject, body: null });
  };
  return { generate, inputs };
}

/** A branch that is ahead of its base, the kind a pull request is opened from. */
export const FEATURE = repoStatus({ branch: "feat/login", upstream: "origin/feat/login", ahead: 2 });

/** A store opened on a feature branch, once the first answer of `gh` is in. */
export async function openedOnFeature(options: FakeOptions = {}) {
  const harness = await opened({ status: FEATURE, ...options });
  await settle();
  return harness;
}

/** A pull request generator that records what it was asked and answers with `reply`. */
export function prGenerator(reply: { title: string; body: string } = { title: "feat(auth): add login", body: "## Summary\n- Adds login" }) {
  const inputs: PullRequestInput[] = [];
  const generate: PullRequestGenerator = (input) => {
    inputs.push(input);
    return Promise.resolve(reply);
  };
  return { generate, inputs };
}
