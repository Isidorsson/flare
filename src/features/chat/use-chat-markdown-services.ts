import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo } from "react";

import { colorizeCode, openFile } from "@/features/files";
import { useLayout } from "@/features/shell/use-layout";

import type { FileTarget } from "./markdown/file-refs";
import type { MarkdownServices } from "./markdown/services";

function report(action: string, error: unknown): void {
  console.error(`flare: could not ${action}`, error);
}

function openFileAt(target: FileTarget): Promise<void> {
  return openFile(target.path, target.line === null ? undefined : { line: target.line });
}

/** Wires markdown links to the user's browser and file references to the Files panel. */
export function useChatMarkdownServices(): MarkdownServices {
  const rightView = useLayout((state) => state.rightView);
  const setRightView = useLayout((state) => state.setRightView);

  return useMemo(
    () => ({
      openUrl: (url) => {
        openUrl(url).catch((error: unknown) => {
          report(`open ${url}`, error);
        });
      },
      openFile: (target) => {
        if (rightView === "graph" || rightView === "changes") setRightView("files");
        openFileAt(target).catch((error: unknown) => {
          report(`open ${target.path}`, error);
        });
      },
      colorize: colorizeCode,
    }),
    [rightView, setRightView],
  );
}
