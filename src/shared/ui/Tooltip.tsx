import {
  cloneElement,
  useEffect,
  useId,
  useReducer,
  useRef,
  type CSSProperties,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { addAnchorName, anchorNameFor } from "./anchor-name";
import {
  CLOSED,
  TOOLTIP_DELAY_MS,
  isOpen,
  timerAction,
  transition,
  type TooltipEvent,
} from "./tooltip-machine";

import "./tooltip.css";

export type TooltipSide = "top" | "bottom" | "left" | "right";

/** What the tooltip puts on its trigger. A trigger that is a component must pass these on to its element. */
export interface TooltipTriggerProps {
  "aria-describedby"?: string | undefined;
  style?: CSSProperties | undefined;
  onPointerEnter?: PointerEventHandler | undefined;
  onPointerLeave?: PointerEventHandler | undefined;
  onPointerDown?: PointerEventHandler | undefined;
  onFocus?: FocusEventHandler | undefined;
  onBlur?: FocusEventHandler | undefined;
}

export interface TooltipProps {
  /** What the control does, in a few words. */
  content: string;
  /** A second, muted line: a path, a status, why something is unavailable. */
  detail?: string | undefined;
  /** A keyboard shortcut, e.g. "Ctrl+S". */
  shortcut?: string | undefined;
  /** Where it opens first; it flips when there is no room. Defaults to below the trigger. */
  side?: TooltipSide | undefined;
  /** The one element the tooltip belongs to. */
  children: ReactElement<TooltipTriggerProps>;
}

type Send = (event: TooltipEvent) => void;

function chain<E>(own: ((event: E) => void) | undefined, ours: (event: E) => void): (event: E) => void {
  return (event) => {
    own?.(event);
    ours(event);
  };
}

function showsFocusRing(target: EventTarget): boolean {
  return target instanceof Element && target.matches(":focus-visible");
}

function listenForEscape(onEscape: () => void): () => void {
  const handler = (event: KeyboardEvent) => {
    if (event.key === "Escape") onEscape();
  };
  document.addEventListener("keydown", handler);
  return () => {
    document.removeEventListener("keydown", handler);
  };
}

function syncPopover(node: HTMLElement | null, open: boolean) {
  if (node === null) return;
  const showing = node.matches(":popover-open");
  if (open && !showing) node.showPopover();
  else if (!open && showing) node.hidePopover();
}

function useTooltipController(): { bubble: RefObject<HTMLDivElement | null>; send: Send } {
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [state, dispatch] = useReducer(transition, CLOSED);
  const open = isOpen(state);

  useEffect(() => {
    syncPopover(bubble.current, open);
  }, [open]);

  useEffect(
    () =>
      open
        ? listenForEscape(() => {
            dispatch("escape");
          })
        : undefined,
    [open],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const send: Send = (event) => {
    dispatch(event);
    const action = timerAction(event);
    if (action === "keep") return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current =
      action === "start"
        ? window.setTimeout(() => {
            dispatch("delay");
          }, TOOLTIP_DELAY_MS)
        : null;
  };

  return { bubble, send };
}

function triggerProps(own: TooltipTriggerProps, send: Send, link: { id: string; anchor: string }): TooltipTriggerProps {
  return {
    "aria-describedby": own["aria-describedby"] === undefined ? link.id : `${own["aria-describedby"]} ${link.id}`,
    style: { ...own.style, anchorName: addAnchorName(own.style?.anchorName, link.anchor) },
    onPointerEnter: chain(own.onPointerEnter, (event) => {
      if (event.pointerType !== "touch") send("pointerenter");
    }),
    onPointerLeave: chain(own.onPointerLeave, () => {
      send("pointerleave");
    }),
    onPointerDown: chain(own.onPointerDown, () => {
      send("press");
    }),
    onFocus: chain(own.onFocus, (event) => {
      if (showsFocusRing(event.target)) send("focus");
    }),
    onBlur: chain(own.onBlur, () => {
      send("blur");
    }),
  };
}

/**
 * Explains its trigger on hover (after a short delay) and on keyboard focus. The trigger keeps its own
 * accessible name: an icon-only control still needs an aria-label, since this text is only a description.
 * The bubble renders in document.body, so it works inside a closed <details> or a tablist alike.
 */
export function Tooltip({ content, detail, shortcut, side = "bottom", children }: TooltipProps) {
  const id = useId();
  const anchor = anchorNameFor("tip", id);
  const { bubble, send } = useTooltipController();

  const bubbleNode = (
    <div
      ref={bubble}
      id={id}
      popover="manual"
      role="tooltip"
      data-side={side}
      style={{ positionAnchor: anchor }}
      className="flare-tooltip"
    >
      <span className="flare-tooltip-row">
        <span className="flare-tooltip-label">{content}</span>
        {shortcut === undefined ? null : <kbd className="flare-tooltip-kbd">{shortcut}</kbd>}
      </span>
      {detail === undefined ? null : <span className="flare-tooltip-detail">{detail}</span>}
    </div>
  );

  return (
    <>
      {cloneElement(children, triggerProps(children.props, send, { id, anchor }))}
      {createPortal(bubbleNode, document.body)}
    </>
  );
}
