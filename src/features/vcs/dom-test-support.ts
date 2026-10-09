import { act } from "react";

// Helpers of the DOM tests. They touch the DOM globals only when called, so importing this module
// before the test registers happy-dom is safe.

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Runs `change` and lets React and the promises it started finish. */
export function settle(change: () => void = () => undefined) {
  return act(async () => {
    change();
    await flush();
  });
}

export function buttons(scope: ParentNode): HTMLButtonElement[] {
  return [...scope.querySelectorAll("button")];
}

export function buttonLabelled(scope: ParentNode, label: string): HTMLButtonElement {
  const found = buttons(scope).find((button) => button.getAttribute("aria-label") === label || button.textContent.trim() === label);
  if (found === undefined) throw new Error(`no button "${label}"`);
  return found;
}

export function press(element: Element) {
  return settle(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// Sets the value the way a user's typing would reach React: through the prototype's setter, not the one React watches on the node.
export function typeInto(element: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  return settle(() => {
    Reflect.set(prototype, "value", text, element);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function chooseOption(element: HTMLSelectElement, value: string) {
  return settle(() => {
    Reflect.set(HTMLSelectElement.prototype, "value", value, element);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
