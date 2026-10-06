import { createFakeGateway, type FakeGateway } from "./fake-gateway";
import { createFilesStore, type FilesStore } from "./files-store";
import type { AgentFileChange } from "./files-types";

export const ROOT = "C:/proj";

export interface Clock {
  now: number;
}

export interface Harness {
  store: FilesStore;
  gateway: FakeGateway;
  clock: Clock;
  state: () => ReturnType<FilesStore["getState"]>;
}

export async function openedStore(initial: Record<string, string> = {}): Promise<Harness> {
  const gateway = createFakeGateway(initial);
  const clock: Clock = { now: 1_000_000 };
  const store = createFilesStore(gateway, () => clock.now);
  store.getState().resetWorkspace(ROOT);
  await store.getState().workspaceOpened(ROOT);
  return { store, gateway, clock, state: () => store.getState() };
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
