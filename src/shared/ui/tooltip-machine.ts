export const TOOLTIP_DELAY_MS = 400;

export type TooltipEvent = "pointerenter" | "pointerleave" | "press" | "focus" | "blur" | "escape" | "delay";

export interface TooltipState {
  hovered: boolean;
  focused: boolean;
  /** The hover delay has elapsed. */
  ready: boolean;
  /** Hidden by Escape or a press; stays hidden until the pointer or focus comes back. */
  dismissed: boolean;
}

export const CLOSED: TooltipState = { hovered: false, focused: false, ready: false, dismissed: false };

export function isOpen(state: TooltipState): boolean {
  return !state.dismissed && (state.focused || (state.hovered && state.ready));
}

const STEPS: Record<TooltipEvent, (state: TooltipState) => TooltipState> = {
  pointerenter: (state) => ({ ...state, hovered: true, ready: false, dismissed: false }),
  pointerleave: (state) => ({ ...state, hovered: false, ready: false }),
  press: (state) => ({ ...state, ready: false, dismissed: true }),
  // Focus that lands while the pointer is over the control comes from a click, so a dismissal stands.
  focus: (state) => ({ ...state, focused: true, dismissed: state.hovered && state.dismissed }),
  blur: (state) => ({ ...state, focused: false }),
  escape: (state) => ({ ...state, dismissed: true }),
  delay: (state) => (state.hovered && !state.dismissed ? { ...state, ready: true } : state),
};

export function transition(state: TooltipState, event: TooltipEvent): TooltipState {
  return STEPS[event](state);
}

export type TimerAction = "start" | "cancel" | "keep";

const TIMER_ACTIONS: Record<TooltipEvent, TimerAction> = {
  pointerenter: "start",
  pointerleave: "cancel",
  press: "cancel",
  escape: "cancel",
  focus: "keep",
  blur: "keep",
  delay: "keep",
};

/** The hover timer starts on entering and is dropped on anything that ends or dismisses the hover. */
export function timerAction(event: TooltipEvent): TimerAction {
  return TIMER_ACTIONS[event];
}
