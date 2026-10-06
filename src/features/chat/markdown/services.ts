import { createContext, useContext } from "react";

import type { ColorizedLine } from "@/features/files";

import type { FileTarget } from "./file-refs";

/** What markdown rendering needs from the rest of the app, so it stays free of Tauri, Monaco and the stores. */
export interface MarkdownServices {
  openUrl: (url: string) => void;
  openFile: (target: FileTarget) => void;
  colorize: (code: string, languageHint: string) => Promise<ColorizedLine[] | null>;
}

export const MarkdownServicesContext = createContext<MarkdownServices | null>(null);

export function useMarkdownServices(): MarkdownServices {
  const services = useContext(MarkdownServicesContext);
  if (services === null) throw new Error("Markdown is rendered outside a MarkdownServicesContext");
  return services;
}
