import { FitAddon, Terminal, type Ghostty } from "ghostty-web";

import { debounce } from "./debounce";
import { INITIAL_COLS, INITIAL_ROWS, TERMINAL_HOST_CLASS, TERMINAL_RESIZE_DEBOUNCE_MS } from "./terminal-constants";
import { classifyKey } from "./terminal-keys";
import { readTerminalAppearance } from "./terminal-theme";

const NOTICE_STYLES = {
  info: "\x1b[2m",
  error: "\x1b[31m",
} as const;
const RESET_STYLE = "\x1b[0m";

export interface TerminalHost {
  term: Terminal;
  element: HTMLElement;
  fit: FitAddon;
}

/**
 * The terminal is opened into a detached element straight away, so output that
 * arrives before the tab is first shown is rendered instead of buffered.
 */
export function openTerminalHost(ghostty: Ghostty): TerminalHost {
  const term = new Terminal({
    ghostty,
    cols: INITIAL_COLS,
    rows: INITIAL_ROWS,
    cursorBlink: true,
    ...readTerminalAppearance(document.documentElement),
  });
  const element = document.createElement("div");
  element.className = TERMINAL_HOST_CLASS;
  term.open(element);
  const fit = new FitAddon();
  term.loadAddon(fit);
  return { term, element, fit };
}

export function writeNotice(term: Terminal, tone: keyof typeof NOTICE_STYLES, text: string): void {
  term.write(`\r\n${NOTICE_STYLES[tone]}[${text}]${RESET_STYLE}\r\n`);
}

export function mountHost({ term, element, fit }: TerminalHost, container: HTMLElement): () => void {
  const fitToContainer = () => {
    const size = fit.proposeDimensions();
    if (size && (size.cols !== term.cols || size.rows !== term.rows)) term.resize(size.cols, size.rows);
  };
  container.append(element);
  fitToContainer();
  const refit = debounce(fitToContainer, TERMINAL_RESIZE_DEBOUNCE_MS);
  const observer = new ResizeObserver(refit.call);
  observer.observe(container);
  return () => {
    observer.disconnect();
    refit.cancel();
    element.remove();
  };
}

export function installKeyHandling(term: Terminal): void {
  term.attachCustomKeyEventHandler((event) => {
    if (classifyKey(event, term.hasSelection()) !== "copy") return false;
    if (term.hasSelection()) copySelection(term);
    return true;
  });
}

function copySelection(term: Terminal): void {
  navigator.clipboard.writeText(term.getSelection()).catch((error: unknown) => {
    console.error("flare: copying the terminal selection failed", error);
  });
  term.clearSelection();
}
