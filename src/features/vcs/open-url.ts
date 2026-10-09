import { openUrl } from "@tauri-apps/plugin-opener";

/** Opens a web address in the user's browser. A failure is logged: there is nothing the caller could do about it. */
export function openInBrowser(url: string): void {
  openUrl(url).catch((error: unknown) => {
    console.error(`flare: could not open ${url}`, error);
  });
}
