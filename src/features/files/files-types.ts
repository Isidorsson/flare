import type { BridgeEventOf, FileChangeKind } from "@flare/protocol";

import type { FsGateway } from "./fs-gateway";
import type { DirEntry, WatchBatch } from "./fs-schemas";

export type AgentChangeKind = FileChangeKind;

/** The bridge `file.change` event plus the turn the caller attributes it to. */
export interface AgentFileChange extends Omit<BridgeEventOf<"file.change">, "type"> {
  turnId: string;
}

export interface TimelineEntry extends AgentFileChange {
  id: string;
}

export type FileStatus = "loading" | "ready" | "binary" | "tooLarge" | "error";

export type DiskConflict = { kind: "modified"; content: string } | { kind: "deleted" };

export interface OpenFile {
  path: string;
  status: FileStatus;
  saved: string;
  draft: string;
  preview: boolean;
  saving: boolean;
  conflict: DiskConflict | null;
  error: string | null;
}

export type ActiveView = { kind: "file"; path: string } | { kind: "diff"; changeId: string } | null;

export type DirState =
  | { status: "loading" }
  | { status: "ready"; entries: DirEntry[]; truncated: boolean }
  | { status: "error"; message: string };

export type WorkspacePhase = "idle" | "opening" | "ready" | "error";
export type SidePane = "explorer" | "timeline";

export interface WorkspaceSlice {
  phase: WorkspacePhase;
  root: string | null;
  generation: number;
  workspaceError: string | null;
  resetWorkspace: (requestedRoot: string | null) => void;
  workspaceOpened: (canonicalRoot: string) => Promise<void>;
  workspaceFailed: (message: string) => void;
  applyWatchBatch: (batch: WatchBatch) => Promise<void>;
}

export interface TreeSlice {
  dirs: Record<string, DirState>;
  expanded: Record<string, true>;
  loadDir: (path: string) => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
}

export interface OpenFileOptions {
  preview?: boolean;
  quiet?: boolean;
}

export interface BufferSlice {
  files: Record<string, OpenFile>;
  tabs: string[];
  active: ActiveView;
  openFile: (path: string, options?: OpenFileOptions) => Promise<void>;
  activateFile: (path: string) => void;
  closeFile: (path: string) => void;
  setDraft: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveActive: () => Promise<void>;
  reloadFile: (path: string) => Promise<void>;
  syncFromDisk: (path: string) => Promise<void>;
  applyDiskContent: (path: string, content: string | null) => void;
}

export type BufferData = Pick<BufferSlice, "files" | "tabs" | "active">;
export type BufferActions = Omit<BufferSlice, keyof BufferData>;

export interface AgentSlice {
  follow: boolean;
  pane: SidePane;
  changes: TimelineEntry[];
  setFollow: (follow: boolean) => void;
  setPane: (pane: SidePane) => void;
  applyAgentFileChange: (change: AgentFileChange) => void;
  noteAgentFileRead: (path: string) => Promise<void>;
  showChange: (changeId: string) => void;
}

export type FilesState = WorkspaceSlice & TreeSlice & BufferSlice & AgentSlice;

export interface StoreContext {
  set: (partial: Partial<FilesState> | ((state: FilesState) => Partial<FilesState>)) => void;
  get: () => FilesState;
  gateway: FsGateway;
}

export function isDirty(file: OpenFile): boolean {
  return file.status === "ready" && file.draft !== file.saved;
}
