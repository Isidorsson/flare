import { describe, expect, test } from "bun:test";

import { DEFAULT_PR_CONTEXT, DEFAULT_PR_INFO, pullRequest } from "./fake-pr-gateway";
import { deferred, repoStatus } from "./fake-gateway";
import { NO_PR_GENERATOR_REASON, createPrBlockedReason, generatePrBlockedReason, prDraftOf, prViewKind } from "./pr-selectors";
import { FEATURE, OTHER_ROOT, opened, openedOnFeature, prGenerator, settle } from "./store-test-support";
import { VcsCommandError, type PrCreateResult } from "./vcs-schemas";
import type { GeneratedPullRequest } from "./vcs-types";

describe("writing the pull request with Claude", () => {
  test("is unavailable until a generator is configured", async () => {
    const { store, state, ghCalls } = await openedOnFeature();
    expect(state().canGeneratePr).toBe(false);
    expect(generatePrBlockedReason(state())).toBe(NO_PR_GENERATOR_REASON);

    await store.getState().generatePr();
    expect(ghCalls).toEqual(["prInfo"]);
  });

  test("fills the title and description from the commits ahead of the base", async () => {
    const { store, state, ghCalls } = await openedOnFeature();
    const { generate, inputs } = prGenerator();
    store.getState().configurePullRequest(generate);
    expect(state().canGeneratePr).toBe(true);

    const generating = store.getState().generatePr();
    expect(state().generatingPr).toBe(true);
    await generating;

    expect(ghCalls).toEqual(["prInfo", "prContext main"]);
    expect(inputs).toEqual([
      {
        branch: "feat/login",
        base: "main",
        commits: DEFAULT_PR_CONTEXT.commits,
        stat: DEFAULT_PR_CONTEXT.stat,
        truncated: false,
      },
    ]);
    expect(prDraftOf(state())).toMatchObject({ title: "feat(auth): add login", body: "## Summary\n- Adds login" });
    expect(state().generatingPr).toBe(false);
  });

  test("describes the commits ahead of the base that was picked", async () => {
    const { store, ghCalls } = await openedOnFeature();
    const { generate, inputs } = prGenerator();
    store.getState().configurePullRequest(generate);
    store.getState().setPrBase("develop");
    await store.getState().generatePr();

    expect(ghCalls).toContain("prContext develop");
    expect(inputs[0]?.base).toBe("develop");
  });

  test("trims what comes back, and the text can be edited afterwards", async () => {
    const { store, state } = await openedOnFeature();
    store.getState().configurePullRequest(prGenerator({ title: "  feat: login \n", body: "\nBody.\n\n" }).generate);
    await store.getState().generatePr();
    expect(prDraftOf(state())).toMatchObject({ title: "feat: login", body: "Body." });

    store.getState().setPrTitle("feat: my own words");
    expect(prDraftOf(state()).title).toBe("feat: my own words");
  });

  test("a failing generator leaves the draft alone and shows the error", async () => {
    const { store, state } = await openedOnFeature();
    store.getState().configurePullRequest(() => Promise.reject(new Error("the bridge is not running")));
    store.getState().setPrTitle("feat: mine");
    await store.getState().generatePr();

    expect(state().errors.generatePr).toBe("the bridge is not running");
    expect(prDraftOf(state()).title).toBe("feat: mine");
    expect(state().generatingPr).toBe(false);
  });

  test("a failing context request is shown in plain words", async () => {
    const { store, state } = await openedOnFeature({
      overrides: { prContext: () => Promise.reject(new VcsCommandError("on_base_branch", "base")) },
    });
    const { generate, inputs } = prGenerator();
    store.getState().configurePullRequest(generate);
    await store.getState().generatePr();

    expect(state().errors.generatePr).toBe("You are on the base branch. Switch to a feature branch to open a pull request.");
    expect(inputs).toEqual([]);
  });

  test("a branch with nothing ahead of its base is explained without bothering the generator", async () => {
    const { store, state, repo } = await openedOnFeature({ prContext: { ...DEFAULT_PR_CONTEXT, commits: [] } });
    const { generate, inputs } = prGenerator();
    store.getState().configurePullRequest(generate);
    store.getState().setPrTitle("feat: nothing");
    await store.getState().generatePr();

    expect(inputs).toEqual([]);
    expect(state().errors.generatePr).toContain("no commits ahead of the base");
    expect(createPrBlockedReason(state())).toBe("feat/login has no commits ahead of main");

    repo.status = { ...repo.status, head: "bbb2222" };
    await store.getState().refresh();
    expect(createPrBlockedReason(state())).toBeNull();
  });

  test("a second generation and Create are blocked while one runs", async () => {
    const slow = deferred<GeneratedPullRequest>();
    const { store, state, ghCalls } = await openedOnFeature();
    let asked = 0;
    store.getState().configurePullRequest(() => {
      asked += 1;
      return slow.promise;
    });
    store.getState().setPrTitle("feat: mine");
    const first = store.getState().generatePr();
    await settle();
    await store.getState().generatePr();
    await store.getState().createPr();

    expect(asked).toBe(1);
    expect(createPrBlockedReason(state())).toBe("The pull request is being written");
    expect(ghCalls.some((call) => call.startsWith("prCreate"))).toBe(false);
    slow.resolve({ title: "feat: generated", body: "" });
    await first;
    expect(prDraftOf(state()).title).toBe("feat: generated");
  });

  test("text that arrives after the folder changed is not put in any draft", async () => {
    const slow = deferred<GeneratedPullRequest>();
    const { store, state } = await openedOnFeature();
    store.getState().configurePullRequest(() => slow.promise);
    const generating = store.getState().generatePr();
    await settle();
    await store.getState().setRoot(OTHER_ROOT);
    slow.resolve({ title: "feat: late", body: "Late." });
    await generating;

    expect(prDraftOf(state()).title).toBe("");
    expect(state().generatingPr).toBe(false);
  });
});

describe("creating the pull request", () => {
  test("opens it, shows the result in place of the form and takes the fresh status", async () => {
    const { store, state, ghCalls } = await openedOnFeature();
    store.getState().setPrTitle("  feat: login ");
    store.getState().setPrBody("Adds login.\n");
    await store.getState().createPr();

    expect(ghCalls.at(-1)).toBe(`prCreate main draft=false ${JSON.stringify("feat: login")}`);
    expect(state().pr.info?.current).toMatchObject({ number: 42, title: "feat: login", base: "main", isDraft: false });
    expect(prViewKind(state())).toBe("existing");
    expect(state().status).toMatchObject({ ahead: 0, upstream: "origin/feat/login" });
    expect(prDraftOf(state())).toMatchObject({ title: "", body: "" });
    expect(state().busy).toBeNull();
  });

  test("the draft switch and the picked base go with it", async () => {
    const { store, state, ghCalls } = await openedOnFeature();
    store.getState().setPrTitle("feat: login");
    store.getState().setPrBase("develop");
    store.getState().setPrDraft(true);
    await store.getState().createPr();

    expect(ghCalls.at(-1)).toBe(`prCreate develop draft=true ${JSON.stringify("feat: login")}`);
    expect(state().pr.info?.current).toMatchObject({ isDraft: true, base: "develop" });
  });

  test("Create explains what is missing and does nothing without a title", async () => {
    const { store, state, ghCalls } = await openedOnFeature();
    expect(createPrBlockedReason(state())).toBe("Write a pull request title first");
    await store.getState().createPr();
    expect(ghCalls).toEqual(["prInfo"]);

    store.getState().setPrTitle("   ");
    expect(createPrBlockedReason(state())).toBe("Write a pull request title first");
    store.getState().setPrTitle("feat: login");
    expect(createPrBlockedReason(state())).toBeNull();
  });

  test("is not offered on the base branch, in a branch that has a pull request or without gh", async () => {
    const onBase = await opened();
    onBase.store.getState().setPrTitle("feat: login");
    expect(createPrBlockedReason(onBase.state())).toBe("A pull request cannot be opened from here");

    const existing = await openedOnFeature({ prInfo: { ...DEFAULT_PR_INFO, current: pullRequest() } });
    expect(createPrBlockedReason(existing.state())).toBe("This branch already has a pull request");

    const missing = await openedOnFeature({ prInfo: { ghAvailable: false, authenticated: false, defaultBase: null, current: null } });
    expect(createPrBlockedReason(missing.state())).toBe("The GitHub CLI is not installed");
  });

  test("a failure is told in plain words, keeps the draft and reads the status again", async () => {
    const { store, state, calls } = await openedOnFeature({
      overrides: { prCreate: () => Promise.reject(new VcsCommandError("gh_unauthenticated", "not logged in")) },
    });
    store.getState().setPrTitle("feat: login");
    await store.getState().createPr();

    expect(state().errors.createPr).toContain("gh auth login");
    expect(prDraftOf(state()).title).toBe("feat: login");
    expect(prViewKind(state())).toBe("form");
    expect(state().busy).toBeNull();
    expect(calls.filter((call) => call === "status")).toHaveLength(2);
  });

  test("a branch the server says has nothing ahead is remembered, so Create says why", async () => {
    const { store, state } = await openedOnFeature({
      overrides: { prCreate: () => Promise.reject(new VcsCommandError("no_commits", "nothing")) },
    });
    store.getState().setPrTitle("feat: login");
    await store.getState().createPr();

    expect(state().errors.createPr).toContain("no commits ahead of the base");
    expect(createPrBlockedReason(state())).toBe("feat/login has no commits ahead of main");
  });

  test("other git actions wait while the pull request is being created", async () => {
    const slow = deferred<PrCreateResult>();
    const { store, state, calls } = await openedOnFeature({ overrides: { prCreate: () => slow.promise } });
    store.getState().setPrTitle("feat: login");
    const creating = store.getState().createPr();
    await settle();

    expect(state().busy).toBe("createPr");
    await store.getState().push();
    expect(calls).not.toContain("push");

    slow.resolve({ pr: pullRequest(), status: repoStatus({ ...FEATURE, ahead: 0 }) });
    await creating;
    expect(state().busy).toBeNull();
    expect(prViewKind(state())).toBe("existing");
  });
});
