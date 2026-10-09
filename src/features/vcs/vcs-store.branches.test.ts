import { describe, expect, test } from "bun:test";

import { repoStatus } from "./fake-gateway";
import { WORKTREE, opened } from "./store-test-support";

describe("branches", () => {
  test("lists them on request", async () => {
    const { store, state } = await opened();
    const loading = store.getState().loadBranches();
    expect(state().branchesLoading).toBe(true);
    await loading;
    expect(state().branches.map((branch) => branch.name)).toEqual(["main", "dev", "origin/main", "origin/feature"]);
    expect(state().branchesLoading).toBe(false);
  });

  test("a failing list is shown under branches", async () => {
    const { store, state } = await opened({ overrides: { branches: () => Promise.reject(new Error("no refs")) } });
    await store.getState().loadBranches();
    expect(state().errors.branches).toBe("no refs");
    expect(state().branchesLoading).toBe(false);
  });

  test("switching changes the branch and reloads the list", async () => {
    const { store, state, calls } = await opened();
    await store.getState().switchBranch("dev");

    expect(calls.slice(1)).toEqual(["switch dev", "branches"]);
    expect(state().status?.branch).toBe("dev");
    expect(state().branches.find((branch) => branch.current)?.name).toBe("dev");
  });

  test("a switch git refuses is shown and nothing else changes", async () => {
    const { store, state, calls } = await opened({
      overrides: { switchBranch: () => Promise.reject(new Error("local changes would be overwritten")) },
    });
    await store.getState().switchBranch("dev");

    expect(state().errors.switchBranch).toBe("local changes would be overwritten");
    expect(state().status?.branch).toBe("main");
    expect(calls).not.toContain("branches");
  });

  test("creating a branch switches to it", async () => {
    const { store, state, calls } = await opened();
    await store.getState().createBranch("  feature/login ");

    expect(calls).toContain("create feature/login");
    expect(state().status?.branch).toBe("feature/login");
    expect(state().status?.upstream).toBeNull();
    expect(state().branches.map((branch) => branch.name)).toContain("feature/login");
  });

  test("a bad or taken name is refused before git is asked", async () => {
    const { store, state, calls } = await opened();
    await store.getState().loadBranches();
    await store.getState().createBranch("two words");
    expect(state().errors.createBranch).toContain("cannot contain spaces");
    await store.getState().createBranch("dev");
    expect(state().errors.createBranch).toBe("A branch named dev already exists");
    expect(calls.some((call) => call.startsWith("create"))).toBe(false);
  });

  test("deleting passes the force flag and reloads the list", async () => {
    const { store, state, calls } = await opened();
    await store.getState().deleteBranch("dev", true);

    expect(calls.slice(1)).toEqual(["delete dev force=true", "branches"]);
    expect(state().branches.map((branch) => branch.name)).not.toContain("dev");
  });

  test("a failed delete is shown under deleteBranch", async () => {
    const { store, state } = await opened({
      overrides: { deleteBranch: () => Promise.reject(new Error("not fully merged")) },
    });
    await store.getState().deleteBranch("dev", false);
    expect(state().errors.deleteBranch).toBe("not fully merged");
  });
});

describe("syncing", () => {
  test("fetch shows the new behind count", async () => {
    const { store, state } = await opened({
      overrides: { fetch: () => Promise.resolve(repoStatus({ behind: 3, files: WORKTREE.files })) },
    });
    await store.getState().fetch();
    expect(state().status?.behind).toBe(3);
  });

  test("pull catches up and push sends the commits", async () => {
    const { store, state, calls } = await opened({ status: repoStatus({ ahead: 2, behind: 1 }) });
    await store.getState().pull();
    expect(state().status?.behind).toBe(0);
    await store.getState().push();
    expect(state().status?.ahead).toBe(0);
    expect(calls.slice(1)).toEqual(["pull", "push"]);
  });

  test("pull is refused without an upstream and push without commits to send", async () => {
    const noUpstream = await opened({ status: repoStatus({ upstream: null }) });
    await noUpstream.store.getState().pull();
    expect(noUpstream.calls).toEqual(["status"]);

    const inStep = await opened();
    await inStep.store.getState().push();
    expect(inStep.calls).toEqual(["status"]);
  });

  test("a failed pull is shown under pull and the status is read again", async () => {
    const { store, state, calls } = await opened({
      status: repoStatus({ behind: 1 }),
      overrides: { pull: () => Promise.reject(new Error("Not possible to fast-forward")) },
    });
    await store.getState().pull();

    expect(state().errors.pull).toBe("Not possible to fast-forward");
    expect(calls).toEqual(["status", "pull", "status"]);
  });

  test("the first push of a branch without an upstream publishes it", async () => {
    const { store, state } = await opened({ status: repoStatus({ upstream: null }) });
    await store.getState().push();
    expect(state().status?.upstream).toBe("origin/main");
  });
});
