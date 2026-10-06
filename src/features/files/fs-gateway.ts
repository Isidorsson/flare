import { Channel, invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import {
  dirListingSchema,
  fileReadSchema,
  subscriptionIdSchema,
  toFsError,
  watchBatchSchema,
  type DirListing,
  type FileRead,
  type WatchBatch,
} from "./fs-schemas";

const unitSchema = z.null().transform((): undefined => undefined);

export type Unsubscribe = () => Promise<void>;

export interface FsGateway {
  openWorkspace: (root: string) => Promise<string>;
  closeWorkspace: () => Promise<void>;
  listDir: (path: string) => Promise<DirListing>;
  readFile: (path: string) => Promise<FileRead>;
  writeFile: (path: string, content: string) => Promise<void>;
  subscribe: (onBatch: (batch: WatchBatch) => void) => Promise<Unsubscribe>;
}

async function call<T>(command: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await invoke(command, args);
  } catch (error) {
    throw toFsError(error);
  }
  return schema.parse(raw);
}

async function subscribe(onBatch: (batch: WatchBatch) => void): Promise<Unsubscribe> {
  const channel = new Channel<unknown>();
  channel.onmessage = (message) => {
    onBatch(watchBatchSchema.parse(message));
  };
  const id = await call("fs_subscribe", { onEvent: channel }, subscriptionIdSchema);
  return async () => {
    await call("fs_unsubscribe", { id }, unitSchema);
  };
}

export const tauriFsGateway: FsGateway = {
  openWorkspace: (root) => call("fs_open_workspace", { root }, z.string()),
  closeWorkspace: () => call("fs_close_workspace", {}, unitSchema),
  listDir: (path) => call("fs_list_dir", { path }, dirListingSchema),
  readFile: (path) => call("fs_read_file", { path }, fileReadSchema),
  writeFile: (path, content) => call("fs_write_file", { path, content }, unitSchema),
  subscribe,
};
