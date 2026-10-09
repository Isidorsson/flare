import { describe, expect, test } from "bun:test";

import { NOT_A_REPO, deferred, file, repoStatus, textDiff, type FakeOptions } from "./fake-gateway";
import { OTHER_ROOT, ROOT, WORKTREE, opened, setup, settle } from "./store-test-support";
import { VcsCommandError, type VcsStatus } from "./vcs-schemas";

describe("opening a workspace", () => {
  test("reads the status of the root", async () => {
    const { calls, state } = await opened();
    expect(calls).toEqual(["status"]);
    expect(state().root).toBe(ROOT);
    expect(state().status?.files).toHaveLength(3);
    expect(state().errors).toEqual({});
  });

  test("with no folder it stays empty and asks git nothing", async () => {
    const { calls, store, state } = setup();
    await store.getState().setRoot(null);
    expect(calls).toEqual([]);
    expect(state().status).toBeNull();
  });

  test("keeps a folder that is not a repository as such, without an error", async () => {
    const { state } = await opened({ status: NOT_A_REPO });
    expect(state().status?.isRepo).toBe(false);
    expect(state().errors).toEqual({});
  });

  test("a failing status is shown under refresh and a later success clears it", async () => {
    let fail = true;
    const { store, state } = setup({
      overrides: {
        status: () => (fail ? Promise.reject(new Error("git is not installed")) : Promise.resolve(WORKTREE)),
      },
    });
    await store.getState().setRoot(ROOT);
    expect(state().status).toBeNull();
    expect(state().errors.refresh).toBe("git is not installed");

    fail = false;
    await store.getState().refresh();
    expect(state().errors.refresh).toBeUndefined();
    expect(state().status?.files).toHaveLength(3);
  });

  test("moving to another folder starts over but keeps the commit drafts", async () => {
    const { store, state, calls } = await opened();
    store.getState().setSubject("feat: keep me");
    await store.getState().selectFile({ path: "src/a.ts", staged: false });

    await store.getState().setRoot(OTHER_ROOT);

    expect(state().root).toBe(OTHER_ROOT);
    expect(state().selection).toBeNull();
    expect(state().diff).toEqual({ kind: "idle" });
    expect(state().drafts[ROOT]?.subject).toBe("feat: keep me");
    expect(calls.filter((call) => call === "status")).toHaveLength(2);
  });

  test("a status that arrives after the folder changed is dropped", async () => {
    const slow = deferred<VcsStatus>();
    let first = true;
    const { store, state } = setup({
      overrides: {
        status: () => {
          if (!first) return Promise.resolve(repoStatus({ branch: "other-branch" }));
          first = false;
          return slow.promise;
        },
      },
    });
    const opening = store.getState().setRoot(ROOT);
    await store.getState().setRoot(OTHER_ROOT);
    slow.resolve(repoStatus({ branch: "stale" }));
    await opening;

    expect(state().status?.branch).toBe("other-branch");
  });

  test("a draft survives going away from a folder and coming back", async () => {
    const { store, state } = await opened();
    store.getState().setSubject("feat: one");
    store.getState().setDescription("About one.");
    await store.getState().setRoot(OTHER_ROOT);
    expect(state().drafts[OTHER_ROOT]).toBeUndefined();
    await store.getState().setRoot(ROOT);
    expect(state().drafts[ROOT]).toMatchObject({ subject: "feat: one", description: "About one." });
  });
});

describe("selecting a file", () => {
  test("loads the diff of that side of the file", async () => {
    const { store, state, calls } = await opened({
      diffs: { "unstaged:src/a.ts": textDiff("src/a.ts", "before\n", "after\n") },
    });
    const loading = store.getState().selectFile({ path: "src/a.ts", staged: false });
    expect(state().diff).toEqual({ kind: "loading" });
    await loading;

    expect(calls).toContain("diff unstaged src/a.ts");
    expect(state().selection).toEqual({ path: "src/a.ts", staged: false });
    expect(state().diff).toMatchObject({ kind: "ready", diff: { original: "before\n", modified: "after\n" } });
  });

  test("a failing diff is shown in place of the diff", async () => {
    const { store, state } = await opened({ overrides: { fileDiff: () => Promise.reject(new Error("bad object")) } });
    await store.getState().selectFile({ path: "src/a.ts", staged: false });
    expect(state().diff).toEqual({ kind: "error", message: "bad object" });
  });

  test("only the last file picked gets its diff", async () => {
    const slow = deferred<ReturnType<typeof textDiff>>();
    const { store, state } = await opened({
      overrides: {
        fileDiff: ({ path }) => (path === "src/a.ts" ? slow.promise : Promise.resolve(textDiff(path, "b-old", "b-new"))),
      },
    });
    const first = store.getState().selectFile({ path: "src/a.ts", staged: false });
    await store.getState().selectFile({ path: "src/b.ts", staged: true });
    slow.resolve(textDiff("src/a.ts", "a-old", "a-new"));
    await first;

    expect(state().selection?.path).toBe("src/b.ts");
    expect(state().diff).toMatchObject({ kind: "ready", diff: { path: "src/b.ts" } });
  });

  test("clearing the selection clears the diff", async () => {
    const { store, state } = await opened();
    await store.getState().selectFile({ path: "src/a.ts", staged: false });
    await store.getState().selectFile(null);
    expect(state().selection).toBeNull();
    expect(state().diff).toEqual({ kind: "idle" });
  });

  test("a refresh keeps the shown diff when the file did not change, and renews it when it did", async () => {
    let modified = "after\n";
    const { store, state } = await opened({
      overrides: { fileDiff: ({ path }) => Promise.resolve(textDiff(path, "before\n", modified)) },
    });
    await store.getState().selectFile({ path: "src/a.ts", staged: false });
    const shown = state().diff;

    await store.getState().refresh();
    await settle();
    expect(state().diff).toBe(shown);

    modified = "edited again\n";
    await store.getState().refresh();
    await settle();
    expect(state().diff).toMatchObject({ kind: "ready", diff: { modified: "edited again\n" } });
    expect(state().diff).not.toBe(shown);
  });

  test("a refresh clears the selection of a file that is no longer changed", async () => {
    const { store, state, repo } = await opened();
    await store.getState().selectFile({ path: "src/a.ts", staged: false });
    repo.status = repoStatus({ files: [file("src/b.ts", "modified", null)] });
    await store.getState().refresh();

    expect(state().selection).toBeNull();
    expect(state().diff).toEqual({ kind: "idle" });
  });
});

describe("staging, unstaging and discarding", () => {
  test("staging a file moves it to Staged in the status the gateway answers with", async () => {
    const { store, state, calls } = await opened();
    await store.getState().stage(["src/a.ts"]);

    expect(calls).toContain("stage src/a.ts");
    const moved = state().status?.files.find((entry) => entry.path === "src/a.ts");
    expect(moved).toMatchObject({ staged: "modified", unstaged: null });
    expect(state().busy).toBeNull();
  });

  test("staging an untracked file reports it as added", async () => {
    const { store, state } = await opened();
    await store.getState().stage(["notes.md"]);
    expect(state().status?.files.find((entry) => entry.path === "notes.md")).toMatchObject({ staged: "added", unstaged: null });
  });

  test("the selection follows a staged file into the Staged list and shows its staged diff", async () => {
    const { store, state, calls } = await opened();
    await store.getState().selectFile({ path: "src/a.ts", staged: false });
    await store.getState().stage(["src/a.ts"]);
    await settle();

    expect(state().selection).toEqual({ path: "src/a.ts", staged: true });
    expect(calls).toContain("diff staged src/a.ts");
  });

  test("unstaging puts a staged file back under Changes", async () => {
    const { store, state } = await opened();
    await store.getState().unstage(["src/b.ts"]);
    expect(state().status?.files.find((entry) => entry.path === "src/b.ts")).toMatchObject({ staged: null, unstaged: "modified" });
  });

  test("discarding drops the edits of a tracked file and leaves an untracked one", async () => {
    const { store, state, calls } = await opened();
    await store.getState().discard(["src/a.ts", "notes.md"]);

    expect(calls).toContain("discard src/a.ts,notes.md");
    const paths = state().status?.files.map((entry) => entry.path);
    expect(paths).not.toContain("src/a.ts");
    expect(paths).toContain("notes.md");
  });

  test("an empty list of paths does nothing", async () => {
    const { store, calls } = await opened();
    await store.getState().stage([]);
    await store.getState().unstage([]);
    await store.getState().discard([]);
    expect(calls).toEqual(["status"]);
  });

  test("stage all and unstage all send an empty list, which the commands read as every file", async () => {
    const { store, state, calls } = await opened();
    await store.getState().stageAll();
    expect(calls).toContain("stage (all)");
    expect(state().status?.files.every((entry) => entry.unstaged === null)).toBe(true);

    await store.getState().unstageAll();
    expect(calls).toContain("unstage (all)");
    expect(state().status?.files.every((entry) => entry.staged === null)).toBe(true);
  });

  test("discarding without paths never reaches git, which would refuse it as an invalid request", async () => {
    const { store, calls } = await opened();
    await store.getState().discard([]);
    expect(calls).toEqual(["status"]);
  });

  test("a staged rename is unstaged with both of its paths when the caller names them", async () => {
    const { store, calls } = await opened();
    await store.getState().unstage(["src/new.ts", "src/old.ts"]);
    expect(calls).toContain("unstage src/new.ts,src/old.ts");
  });

  test("a failure is recorded under its action, the status is read again and the buttons are free", async () => {
    const { store, state, calls } = await opened({
      overrides: { stage: () => Promise.reject(new Error("index.lock exists")) },
    });
    await store.getState().stage(["src/a.ts"]);

    expect(state().errors.stage).toBe("index.lock exists");
    expect(state().busy).toBeNull();
    expect(calls).toEqual(["status", "stage src/a.ts", "status"]);
  });

  test("running the action again clears its old error, and dismissing clears it by hand", async () => {
    let fail = true;
    const { store, state } = await opened({
      overrides: {
        stage: () => (fail ? Promise.reject(new Error("nope")) : Promise.resolve(WORKTREE)),
      },
    });
    await store.getState().stage(["src/a.ts"]);
    expect(state().errors.stage).toBe("nope");

    fail = false;
    await store.getState().stage(["src/a.ts"]);
    expect(state().errors.stage).toBeUndefined();

    fail = true;
    await store.getState().stage(["src/a.ts"]);
    store.getState().dismissError("stage");
    expect(state().errors).toEqual({});
  });

  test("while one action runs, another is refused instead of racing it", async () => {
    const slow = deferred<VcsStatus>();
    const { store, state, calls } = await opened({ overrides: { stage: () => slow.promise } });
    const staging = store.getState().stage(["src/a.ts"]);
    expect(state().busy).toBe("stage");

    await store.getState().unstage(["src/b.ts"]);
    await store.getState().fetch();
    expect(calls).toEqual(["status", "stage src/a.ts"]);

    slow.resolve(WORKTREE);
    await staging;
    expect(state().busy).toBeNull();
  });

  test("refuses every action in a folder that is not a repository", async () => {
    const { store, calls } = await opened({ status: NOT_A_REPO });
    await store.getState().stage(["a"]);
    await store.getState().fetch();
    expect(calls).toEqual(["status"]);
  });
});

describe("committing", () => {
  function drafted(options: FakeOptions = {}) {
    return opened({ status: repoStatus({ files: [file("src/b.ts", "modified", null), file("src/a.ts", null, "modified")] }), ...options });
  }

  test("sends the subject and description as one message, then empties the draft but keeps the toggle", async () => {
    const { store, state, calls } = await drafted();
    store.getState().setSubject("feat(files): add diffs");
    store.getState().setDescription("Because reviewing needs them.");
    store.getState().setIncludeBody(true);
    await store.getState().commit();

    expect(calls).toContain(`commit ${JSON.stringify("feat(files): add diffs\n\nBecause reviewing needs them.")}`);
    expect(state().drafts[ROOT]).toEqual({ subject: "", description: "", includeBody: true });
    expect(state().status?.ahead).toBe(1);
    expect(state().status?.files.map((entry) => entry.path)).toEqual(["src/a.ts"]);
    expect(state().busy).toBeNull();
  });

  test("a subject alone is committed as it is", async () => {
    const { store, calls } = await drafted();
    store.getState().setSubject("  fix: trim me  ");
    await store.getState().commit();
    expect(calls).toContain(`commit ${JSON.stringify("fix: trim me")}`);
  });

  test("does nothing without a subject or without anything staged", async () => {
    const { store, calls } = await drafted();
    await store.getState().commit();
    expect(calls).toEqual(["status"]);

    const unstaged = await opened({ status: repoStatus({ files: [file("a.ts", null, "modified")] }) });
    unstaged.store.getState().setSubject("fix: a");
    await unstaged.store.getState().commit();
    expect(unstaged.calls).toEqual(["status"]);
  });

  test("a failed commit keeps what was typed and says why", async () => {
    const { store, state } = await drafted({
      overrides: { commit: () => Promise.reject(new Error("pre-commit hook failed")) },
    });
    store.getState().setSubject("feat: keep me");
    await store.getState().commit();

    expect(state().errors.commit).toBe("pre-commit hook failed");
    expect(state().drafts[ROOT]?.subject).toBe("feat: keep me");
    expect(state().busy).toBeNull();
  });

  test("a code from the commands is shown as a plain sentence", async () => {
    const { store, state } = await drafted({
      overrides: { commit: () => Promise.reject(new VcsCommandError("nothing_staged", "nothing to commit")) },
    });
    store.getState().setSubject("feat: a");
    await store.getState().commit();
    expect(state().errors.commit).toBe("Nothing is staged. Stage at least one file to commit.");
  });

  test("a push without a remote explains what is missing even after the commit went through", async () => {
    const { store, state } = await drafted({
      overrides: { push: () => Promise.reject(new VcsCommandError("no_remote", "no remote")) },
    });
    store.getState().setSubject("feat: a");
    await store.getState().commitAndPush();
    expect(state().errors.commitAndPush).toStartWith("Committed, but pushing failed: This repository has no remote.");
  });

  test("commit and push commits first and then pushes", async () => {
    const { store, state, calls } = await drafted();
    store.getState().setSubject("feat: ship it");
    await store.getState().commitAndPush();

    expect(calls.slice(1, 3)).toEqual([`commit ${JSON.stringify("feat: ship it")}`, "push"]);
    expect(state().status?.ahead).toBe(0);
    expect(state().drafts[ROOT]?.subject).toBe("");
  });

  test("when the push fails the commit stays made: the draft is gone and the error says so", async () => {
    const { store, state } = await drafted({ overrides: { push: () => Promise.reject(new Error("rejected: non-fast-forward")) } });
    store.getState().setSubject("feat: ship it");
    await store.getState().commitAndPush();

    expect(state().errors.commitAndPush).toBe("Committed, but pushing failed: rejected: non-fast-forward");
    expect(state().drafts[ROOT]?.subject).toBe("");
    expect(state().status?.ahead).toBe(1);
    expect(state().busy).toBeNull();
  });

  test("commit and push is refused on a detached HEAD", async () => {
    const { store, calls } = await drafted({
      status: repoStatus({ branch: null, files: [file("a.ts", "modified", null)] }),
    });
    store.getState().setSubject("fix: a");
    await store.getState().commitAndPush();
    expect(calls).toEqual(["status"]);
  });
});
