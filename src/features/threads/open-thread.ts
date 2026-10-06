import type { Thread } from "@/features/agent/thread-types";

export interface OpenThreadDeps {
  currentRoot: string | null;
  setRoot: (root: string) => void;
  selectThread: (id: string) => void;
}

/** A thread belongs to the folder it was started in, so opening it brings the files, graph and terminal along. */
export function openThread(thread: Thread, deps: OpenThreadDeps): void {
  if (deps.currentRoot !== thread.cwd) deps.setRoot(thread.cwd);
  deps.selectThread(thread.id);
}
