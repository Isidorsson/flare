import { describe, expect, test } from "bun:test";

import { DEFAULT_PR_INFO, pullRequest } from "./fake-pr-gateway";
import { NOT_A_REPO, deferred, file, repoStatus } from "./fake-gateway";
import { prDraftOf, prViewKind } from "./pr-selectors";
import { FEATURE, OTHER_ROOT, ROOT, opened, openedOnFeature, settle } from "./store-test-support";
import type { PrInfo } from "./vcs-schemas";

const WITH_PR: PrInfo = { ...DEFAULT_PR_INFO, current: pullRequest({ number: 7, title: "feat: login" }) };

describe("looking up the pull request of a branch", () => {
  test("asks gh once when the folder opens and keeps the answer", async () => {
    const { state, ghCalls } = await openedOnFeature();
    expect(ghCalls).toEqual(["prInfo"]);
    expect(state().pr).toMatchObject({ info: DEFAULT_PR_INFO, branch: "feat/login", loading: false });
    expect(prViewKind(state())).toBe("form");
  });

  test("shows the pull request the branch already has", async () => {
    const { state } = await openedOnFeature({ prInfo: WITH_PR });
    expect(prViewKind(state())).toBe("existing");
    expect(state().pr.info?.current?.number).toBe(7);
  });

  test("a plain status refresh never costs a gh call, however many come", async () => {
    const { store, ghCalls } = await openedOnFeature();
    await store.getState().refresh();
    await store.getState().refresh();
    await store.getState().refresh();
    expect(ghCalls).toEqual(["prInfo"]);
  });

  test("a manual reload reads the status and asks gh again", async () => {
    const { store, calls, ghCalls } = await openedOnFeature();
    await store.getState().reload();
    expect(ghCalls).toEqual(["prInfo", "prInfo"]);
    expect(calls.filter((call) => call === "status")).toHaveLength(2);
  });

  test("a question already on its way is reused instead of asked twice", async () => {
    const slow = deferred<PrInfo>();
    const { store, ghCalls } = await opened({ status: FEATURE, overrides: { prInfo: () => slow.promise } });
    const second = store.getState().loadPrInfo();
    const third = store.getState().loadPrInfo();
    slow.resolve(DEFAULT_PR_INFO);
    await Promise.all([second, third]);
    expect(ghCalls).toEqual(["prInfo"]);
  });

  test("switching branch asks gh about the new branch", async () => {
    const { store, state, ghCalls } = await openedOnFeature();
    await store.getState().switchBranch("dev");
    await settle();
    expect(ghCalls).toEqual(["prInfo", "prInfo"]);
    expect(state().pr.branch).toBe("dev");
  });

  test("creating a branch asks gh about it too", async () => {
    const { store, state, ghCalls } = await openedOnFeature();
    await store.getState().createBranch("feat/signup");
    await settle();
    expect(ghCalls).toEqual(["prInfo", "prInfo"]);
    expect(state().pr.branch).toBe("feat/signup");
  });

  test("the pull request of the old branch is not shown while the new branch is looked up", async () => {
    const slow = deferred<PrInfo>();
    let asked = 0;
    const { store, state } = await openedOnFeature({
      prInfo: WITH_PR,
      overrides: { prInfo: () => (++asked === 1 ? Promise.resolve(WITH_PR) : slow.promise) },
    });
    expect(prViewKind(state())).toBe("existing");

    await store.getState().switchBranch("dev");
    expect(prViewKind(state())).toBe("checking");
    slow.resolve(DEFAULT_PR_INFO);
    await store.getState().loadPrInfo();
    expect(prViewKind(state())).toBe("form");
  });

  test("a push asks gh again, and so does a commit that is pushed", async () => {
    const { store, ghCalls } = await openedOnFeature({ status: repoStatus({ ...FEATURE, files: [file("a.ts", "modified", null)] }) });
    await store.getState().push();
    expect(ghCalls).toEqual(["prInfo", "prInfo"]);

    store.getState().setSubject("feat: more");
    await store.getState().commitAndPush();
    expect(ghCalls).toEqual(["prInfo", "prInfo", "prInfo"]);
  });

  test("a failed push does not ask gh", async () => {
    const { store, ghCalls } = await openedOnFeature({ overrides: { push: () => Promise.reject(new Error("rejected")) } });
    await store.getState().push();
    expect(ghCalls).toEqual(["prInfo"]);
  });

  test("a folder that is not a repository, or a detached HEAD, never reaches gh", async () => {
    const outside = await opened({ status: NOT_A_REPO });
    await outside.state().loadPrInfo();
    expect(outside.ghCalls).toEqual([]);

    const detached = await opened({ status: repoStatus({ branch: null }) });
    await detached.state().loadPrInfo();
    expect(detached.ghCalls).toEqual([]);
    expect(prViewKind(detached.state())).toBe("hidden");
  });

  test("a failure is shown and not retried by plain refreshes, only by asking again", async () => {
    let failing = true;
    const { store, state, ghCalls } = await openedOnFeature({
      overrides: { prInfo: () => (failing ? Promise.reject(new Error("gh crashed")) : Promise.resolve(DEFAULT_PR_INFO)) },
    });
    expect(state().errors.loadPr).toBe("gh crashed");
    expect(prViewKind(state())).toBe("failed");
    expect(state().pr.loading).toBe(false);

    await store.getState().refresh();
    expect(ghCalls).toEqual(["prInfo"]);

    failing = false;
    await store.getState().loadPrInfo();
    expect(state().errors.loadPr).toBeUndefined();
    expect(prViewKind(state())).toBe("form");
  });

  test("an answer that arrives after the folder changed is dropped", async () => {
    const slow = deferred<PrInfo>();
    let asked = 0;
    const { store, state } = await opened({
      status: FEATURE,
      overrides: { prInfo: () => (++asked === 1 ? slow.promise : Promise.resolve({ ...DEFAULT_PR_INFO, defaultBase: "develop" })) },
    });
    await store.getState().setRoot(OTHER_ROOT);
    slow.resolve({ ...DEFAULT_PR_INFO, defaultBase: "stale" });
    await settle();

    expect(state().pr.info?.defaultBase).toBe("develop");
    expect(state().pr.loading).toBe(false);
  });

  test("a missing or signed-out gh is an answer, not an error", async () => {
    const missing = await openedOnFeature({ prInfo: { ghAvailable: false, authenticated: false, defaultBase: null, current: null } });
    expect(missing.state().errors.loadPr).toBeUndefined();
    expect(prViewKind(missing.state())).toBe("ghMissing");

    const signedOut = await openedOnFeature({ prInfo: { ...DEFAULT_PR_INFO, authenticated: false, defaultBase: null } });
    expect(prViewKind(signedOut.state())).toBe("signedOut");
  });

  test("opening the section lists the branches for the base picker, but only when there is a form", async () => {
    const form = await openedOnFeature();
    await form.store.getState().setPrExpanded(true);
    expect(form.calls).toContain("branches");
    expect(form.state().branches.map((branch) => branch.name)).toContain("dev");

    const existing = await openedOnFeature({ prInfo: WITH_PR });
    await existing.store.getState().setPrExpanded(true);
    expect(existing.calls).not.toContain("branches");
  });
});

describe("the pull request draft", () => {
  test("keeps a title, description, base and draft flag for each branch", async () => {
    const { store, state } = await openedOnFeature();
    store.getState().setPrTitle("feat: login");
    store.getState().setPrBody("Adds login.");
    store.getState().setPrBase("develop");
    store.getState().setPrDraft(true);
    expect(prDraftOf(state())).toEqual({ base: "develop", title: "feat: login", body: "Adds login.", isDraft: true });

    await store.getState().switchBranch("dev");
    expect(prDraftOf(state()).title).toBe("");

    await store.getState().switchBranch("feat/login");
    expect(prDraftOf(state()).title).toBe("feat: login");
  });

  test("lasts when the folder changes and comes back", async () => {
    const { store, state } = await openedOnFeature();
    store.getState().setPrTitle("feat: login");
    await store.getState().setRoot(OTHER_ROOT);
    expect(prDraftOf(state()).title).toBe("");
    await store.getState().setRoot(ROOT);
    expect(prDraftOf(state()).title).toBe("feat: login");
  });
});
