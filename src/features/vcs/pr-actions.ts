import type { VcsController } from "./vcs-controller";
import type { PullRequestGenerator } from "./vcs-types";

/** The pull request half of the store's actions; like the rest, they answer when done and never reject. */
export interface PrActions {
  configurePullRequest: (generate: PullRequestGenerator) => void;
  /** Asks `gh` about the current branch again. */
  loadPrInfo: () => Promise<void>;
  /** Opens or closes the Pull request section; opening it lists the branches for the base picker. */
  setPrExpanded: (expanded: boolean) => Promise<void>;
  generatePr: () => Promise<void>;
  createPr: () => Promise<void>;
  setPrBase: (base: string) => void;
  setPrTitle: (title: string) => void;
  setPrBody: (body: string) => void;
  setPrDraft: (isDraft: boolean) => void;
}

export function bindPrActions(controller: VcsController): PrActions {
  return {
    configurePullRequest: (generate) => {
      controller.configurePullRequest(generate);
    },
    loadPrInfo: () => controller.loadPrInfo(),
    setPrExpanded: (expanded) => controller.setPrExpanded(expanded),
    generatePr: () => controller.generatePr(),
    createPr: () => controller.createPr(),
    setPrBase: (base) => {
      controller.setPrBase(base);
    },
    setPrTitle: (title) => {
      controller.setPrTitle(title);
    },
    setPrBody: (body) => {
      controller.setPrBody(body);
    },
    setPrDraft: (isDraft) => {
      controller.setPrDraft(isDraft);
    },
  };
}
