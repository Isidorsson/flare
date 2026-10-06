import { Ghostty } from "ghostty-web";
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url";

let loading: Promise<Ghostty> | null = null;

/**
 * ghostty-web's own `init()` inlines the WASM as a data: URL, which the CSP's
 * connect-src would have to allow; loading it from a Vite asset URL keeps the
 * policy to 'self' plus 'wasm-unsafe-eval'.
 */
export function loadGhostty(): Promise<Ghostty> {
  loading ??= Ghostty.load(wasmUrl).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}
