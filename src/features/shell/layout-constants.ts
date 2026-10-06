export interface PaneLimits {
  min: number;
  max: number;
  initial: number;
}

export const PANE_LIMITS = {
  sidebar: { min: 200, max: 420, initial: 280 },
  right: { min: 520, max: 1600, initial: 820 },
  graph: { min: 220, max: 1200, initial: 380 },
  terminal: { min: 120, max: 720, initial: 260 },
} as const satisfies Record<string, PaneLimits>;

export const CENTER_MIN_WIDTH = 420;
export const FILES_MIN_WIDTH = 280;
export const CHAT_MIN_HEIGHT = 240;
export const TERMINAL_HEADER_HEIGHT = 36;

export const LAYOUT_STORAGE_KEY = "flare.layout";
export const LAYOUT_STORAGE_VERSION = 1;
