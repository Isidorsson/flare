import { useLayoutEffect, useRef, type RefObject, type UIEventHandler } from "react";

export const STICK_THRESHOLD_PX = 64;

interface StickToBottom<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onScroll: UIEventHandler<T>;
}

export function useStickToBottom<T extends HTMLElement>(contentVersion: unknown): StickToBottom<T> {
  const ref = useRef<T>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [contentVersion]);

  const onScroll: UIEventHandler<T> = (event) => {
    const element = event.currentTarget;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_THRESHOLD_PX;
  };

  return { ref, onScroll };
}
