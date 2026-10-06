import * as monaco from "monaco-editor";

import { DecorationSet } from "./decoration-set";
import {
  addedDecorations,
  caretAfterStep,
  markDecorations,
  readDecorations,
  type Decoration,
  type LineInfo,
  type Ruler,
} from "./decorations";
import { editLabel } from "./edit-steps";
import type { EditPlay, Play, ReadPlay, TypingPlay } from "./live-types";
import { planRead, scrollMode } from "./read-plan";
import type { TurnMarks } from "./turn-summary";
import { TypingSession } from "./typing-session";
import { previewTyping, typingLabel } from "./typing-preview";
import { CaretWidget, LabelWidget, PhantomZones, TypingPanelWidget, type LabelTone } from "./widgets";

type Editor = monaco.editor.IStandaloneCodeEditor;

const PANEL_TAIL_LINES = 14;

interface Shown {
  id: number;
  kind: Play["kind"];
  // The last step of an edit that has been drawn.
  step: number;
  // What the lines a typed edit replaces were, so they are only redrawn when that changes.
  replaced: string;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Draws a play on the file's model: wave or sweep decorations, struck-through
 * blocks for removed lines, the caret and the floating label, and scrolls the
 * work into view. It only ever draws; what to draw and when comes from the player.
 */
export class PlayRenderer {
  readonly #editor: Editor;
  readonly #model: monaco.editor.ITextModel;
  readonly #path: string;
  readonly #ruler: Ruler;
  readonly #marks: DecorationSet;
  readonly #zones: PhantomZones;
  readonly #typing: TypingSession;
  #sets: DecorationSet[] = [];
  #label: LabelWidget | null = null;
  #caret: CaretWidget | null = null;
  #panel: TypingPanelWidget | null = null;
  #shown: Shown | null = null;

  constructor(editor: Editor, model: monaco.editor.ITextModel, path: string, rulerColor: string) {
    this.#editor = editor;
    this.#model = model;
    this.#path = path;
    this.#ruler = { color: rulerColor, lane: monaco.editor.OverviewRulerLane.Left };
    this.#marks = new DecorationSet(model);
    this.#zones = new PhantomZones(editor);
    this.#typing = new TypingSession(editor, model);
  }

  render(play: Play | null): void {
    if (play?.path !== this.#path) {
      this.#clear();
      return;
    }
    if (play.kind === "read") this.#renderRead(play);
    else if (play.kind === "edit") this.#renderEdit(play);
    else this.#renderTyping(play);
  }

  setMarks(marks: TurnMarks | null): void {
    this.#marks.set(marks === null ? [] : markDecorations(marks, this.#lineInfo(this.#model), this.#ruler));
  }

  dispose(): void {
    this.#clear();
    this.#marks.clear();
  }

  #lineInfo(model: monaco.editor.ITextModel): LineInfo {
    return { lineCount: model.getLineCount(), maxColumn: (line) => model.getLineMaxColumn(line) };
  }

  #renderRead(play: ReadPlay): void {
    if (this.#shown?.id === play.id) return;
    this.#clear();
    this.#shown = { id: play.id, kind: "read", step: -1, replaced: "" };
    const plan = planRead(play.request, this.#model.getLineCount());
    this.#addSet(readDecorations(plan));
    this.#placeLabel(plan.label, "read", plan.first);
    this.#reveal(plan.first, plan.last, { instant: play.instantScroll, always: true });
  }

  #renderEdit(play: EditPlay): void {
    const shown = this.#begin(play);
    for (let index = shown.step + 1; index <= play.stepIndex; index += 1) {
      this.#renderStep(play, index, index === 0 && play.instantScroll);
    }
    shown.step = play.stepIndex;
  }

  // The state of the play being drawn, starting from a clean slate when it is a new one.
  #begin(play: Play): Shown {
    if (this.#shown?.id === play.id) return this.#shown;
    this.#clear();
    const shown: Shown = { id: play.id, kind: play.kind, step: -1, replaced: "" };
    this.#shown = shown;
    return shown;
  }

  #renderStep(play: EditPlay, index: number, instant: boolean): void {
    const step = play.steps[index];
    if (step === undefined) return;
    const info = this.#lineInfo(this.#model);
    this.#addSet(addedDecorations(step, info, { settled: play.settled }));
    for (const hunk of step.hunks) this.#zones.add(hunk.newStart - 1, hunk.removed, { persist: false });
    this.#placeLabel(editLabel({ step, stepIndex: index, stepCount: play.steps.length, created: play.created }), "edit", step.firstLine);
    this.#placeCaret(caretAfterStep(step, info));
    this.#reveal(step.firstLine, step.lastLine, { instant, always: false });
  }

  #renderTyping(play: TypingPlay): void {
    if (prefersReducedMotion()) {
      this.#clear();
      return;
    }
    const view = previewTyping(this.#model.getValue(), play.edit);
    if (view === null) {
      this.#showPanel(play);
      return;
    }
    const entering = this.#shown?.id !== play.id;
    const shown = this.#begin(play);
    this.#hidePanel();
    this.#typing.show(view);
    this.#drawReplaced(shown, view.typedStart.line, view.replaced);
    this.#placeLabel(typingLabel(view, { created: play.created, kind: play.edit.kind }), "edit", view.typedStart.line);
    this.#placeCaret(view.typedEnd);
    if (entering) this.#reveal(view.typedStart.line, view.typedEnd.line, { instant: true, always: false });
    else this.#editor.revealLine(this.#clampLine(view.typedEnd.line), monaco.editor.ScrollType.Smooth);
  }

  // The lines being replaced stay struck through above the typed text for as long as it is being typed.
  #drawReplaced(shown: Shown, line: number, removed: readonly string[]): void {
    const key = removed.join("\n");
    if (shown.replaced === key) return;
    shown.replaced = key;
    this.#zones.clear();
    this.#zones.add(line - 1, removed, { persist: true });
  }

  #showPanel(play: TypingPlay): void {
    this.#begin(play);
    this.#typing.hide();
    if (this.#panel === null) {
      this.#panel = new TypingPanelWidget("Claude · typing an edit");
      this.#editor.addOverlayWidget(this.#panel);
    }
    this.#panel.setText(play.edit.text.split("\n").slice(-PANEL_TAIL_LINES).join("\n"));
  }

  #hidePanel(): void {
    if (this.#panel === null) return;
    this.#editor.removeOverlayWidget(this.#panel);
    this.#panel = null;
  }

  #addSet(decorations: Decoration[]): void {
    const set = new DecorationSet(this.#model);
    set.set(decorations);
    this.#sets.push(set);
  }

  // Monaco throws for a line the displayed model does not have, and a removal at the very end points one line past it.
  #clampLine(line: number): number {
    const lineCount = this.#editor.getModel()?.getLineCount() ?? 1;
    return Math.max(1, Math.min(line, lineCount));
  }

  #placeLabel(text: string, tone: LabelTone, line: number): void {
    if (this.#label === null) {
      this.#label = new LabelWidget(text, tone);
      this.#label.moveTo(this.#clampLine(line));
      this.#editor.addContentWidget(this.#label);
      return;
    }
    this.#label.update(text, tone);
    this.#label.moveTo(this.#clampLine(line));
    this.#editor.layoutContentWidget(this.#label);
  }

  #placeCaret(position: { line: number; column: number } | null): void {
    if (position === null) {
      this.#removeCaret();
      return;
    }
    if (this.#caret === null) {
      this.#caret = new CaretWidget(this.#editor.getOption(monaco.editor.EditorOption.lineHeight));
      this.#caret.moveTo(position.line, position.column);
      this.#editor.addContentWidget(this.#caret);
      return;
    }
    this.#caret.moveTo(position.line, position.column);
    this.#editor.layoutContentWidget(this.#caret);
  }

  #removeLabel(): void {
    if (this.#label === null) return;
    this.#editor.removeContentWidget(this.#label);
    this.#label = null;
  }

  #removeCaret(): void {
    if (this.#caret === null) return;
    this.#editor.removeContentWidget(this.#caret);
    this.#caret = null;
  }

  // Bring a span of lines into view: centred if it fits, else its first line near the top.
  #reveal(rawFirst: number, rawLast: number, { instant, always }: { instant: boolean; always: boolean }): void {
    const first = this.#clampLine(rawFirst);
    const last = this.#clampLine(rawLast);
    const type = instant ? monaco.editor.ScrollType.Immediate : monaco.editor.ScrollType.Smooth;
    const lineHeight = this.#editor.getOption(monaco.editor.EditorOption.lineHeight);
    const visible = Math.floor(this.#editor.getLayoutInfo().height / lineHeight);
    if (scrollMode(first, last, visible) === "top") {
      this.#editor.revealLineNearTop(first, type);
      return;
    }
    const range = { startLineNumber: first, startColumn: 1, endLineNumber: last, endColumn: 1 };
    if (always) this.#editor.revealRangeInCenter(range, type);
    else this.#editor.revealRangeInCenterIfOutsideViewport(range, type);
  }

  #clear(): void {
    for (const set of this.#sets) set.clear();
    this.#sets = [];
    this.#zones.clear();
    this.#removeLabel();
    this.#removeCaret();
    this.#hidePanel();
    this.#typing.hide();
    this.#shown = null;
  }
}
