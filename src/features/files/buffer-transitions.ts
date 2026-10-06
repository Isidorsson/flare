import { loadingFile } from "./buffer-model";
import type { FilesState } from "./files-types";
import { omitKey, patchFile } from "./store-utils";

type Transition = (state: FilesState) => Partial<FilesState>;

/** Adds a loading tab; a preview tab replaces the previous (always clean) preview tab. */
export function withTab(path: string, preview: boolean): Transition {
  return (state) => {
    const stale = preview ? state.tabs.find((tab) => state.files[tab]?.preview && tab !== path) : undefined;
    const files = stale === undefined ? state.files : omitKey(state.files, stale);
    const tabs = [...state.tabs.filter((tab) => tab !== stale), path];
    return { files: { ...files, [path]: loadingFile(path, preview) }, tabs, active: { kind: "file", path } };
  };
}

export function withoutTab(path: string): Transition {
  return (state) => {
    const index = state.tabs.indexOf(path);
    if (index < 0) return {};
    const tabs = state.tabs.filter((tab) => tab !== path);
    const closingActive = state.active?.kind === "file" && state.active.path === path;
    const neighbour = tabs[index] ?? tabs[index - 1];
    const fallback = neighbour === undefined ? null : { kind: "file" as const, path: neighbour };
    const reveal = state.reveal?.path === path ? null : state.reveal;
    return { files: omitKey(state.files, path), tabs, active: closingActive ? fallback : state.active, reveal };
  };
}

export function activating(path: string, pin: boolean): Transition {
  return (state) => ({
    ...(pin ? patchFile(path, { preview: false })(state) : {}),
    active: { kind: "file", path },
  });
}
