export interface Debounced {
  call: () => void;
  cancel: () => void;
}

export function debounce(action: () => void, delayMs: number): Debounced {
  let handle: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (handle === undefined) return;
    clearTimeout(handle);
    handle = undefined;
  };

  const call = () => {
    cancel();
    handle = setTimeout(() => {
      handle = undefined;
      action();
    }, delayMs);
  };

  return { call, cancel };
}
