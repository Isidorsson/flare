import { createFakeGateway, type FakeGateway } from "./fake-gateway";
import { createFilesStore, type FilesStore } from "./files-store";
import type { AgentFileChange } from "./files-types";

export const ROOT = "C:/proj";

export interface Harness {
  store: FilesStore;
  gateway: FakeGateway;
  state: () => ReturnType<FilesStore["getState"]>;
}

export async function openedStore(initial: Record<string, string> = {}): Promise<Harness> {
  const gateway = createFakeGateway(initial);
  const store = createFilesStore(gateway);
  store.getState().resetWorkspace(ROOT);
  await store.getState().workspaceOpened(ROOT);
  return { store, gateway, state: () => store.getState() };
}

export function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function agentChange(overrides: Partial<AgentFileChange> = {}): AgentFileChange {
  return {
    turnId: "turn-a",
    toolUseId: "tool-1",
    path: `${ROOT}/src/a.ts`,
    kind: "update",
    before: "old",
    after: "new",
    ...overrides,
  };
}
