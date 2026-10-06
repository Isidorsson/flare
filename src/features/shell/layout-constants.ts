export const RIGHT_TABS = ["files", "graph"] as const;
export type RightTab = (typeof RIGHT_TABS)[number];

export interface PaneLimits {
  min: number;
  max: number;
  initial: number;
}

export const PANE_LIMITS = {
  sidebar: { min: 200, max: 420, initial: 280 },
  right: { min: 300, max: 800, initial: 420 },
  terminal: { min: 120, max: 720, initial: 260 },
} as const satisfies Record<string, PaneLimits>;

export const CENTER_MIN_WIDTH = 420;
export const CHAT_MIN_HEIGHT = 240;
export const TERMINAL_HEADER_HEIGHT = 36;

export const LAYOUT_STORAGE_KEY = "flare.layout";
export const LAYOUT_STORAGE_VERSION = 1;
