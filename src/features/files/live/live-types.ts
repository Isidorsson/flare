import type { FileEditingKind, LineRange } from "@flare/protocol";

import type { EditStep } from "./edit-steps";

/** What the agent read: lines it asked for, or the lines a search matched. */
export interface ReadRequest {
  range: LineRange | null;
  pattern: string | null;
  matchLines: readonly number[] | null;
}

/** The edit the model is typing right now. */
export interface TypingEdit {
  kind: FileEditingKind;
  oldString: string | null;
  text: string;
}

export interface ReadPlay {
  kind: "read";
  id: number;
  path: string;
  request: ReadRequest;
  instantScroll: boolean;
}

export interface EditPlay {
  kind: "edit";
  id: number;
  path: string;
  steps: readonly EditStep[];
  stepIndex: number;
  created: boolean;
  // The edit was already typed out on screen, so it settles instead of being played from scratch.
  settled: boolean;
  instantScroll: boolean;
}

export interface TypingPlay {
  kind: "typing";
  id: number;
  path: string;
  edit: TypingEdit;
  // The file does not exist yet, so there is an empty tab to type into.
  created: boolean;
}

/** What the editor shows on top of the file right now. */
export type Play = ReadPlay | EditPlay | TypingPlay;

export type TouchKind = "read" | "edit";
