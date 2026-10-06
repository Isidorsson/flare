import { listen } from "@tauri-apps/api/event";

export const GRAPH_CHANGED_EVENT = "graph:changed";

export type Unlisten = () => void;
export type Listen = (event: string, handler: () => void) => Promise<Unlisten>;

export interface Subscription {
  cancel: () => void;
}

export const tauriListen: Listen = (event, handler) =>
  listen(event, () => {
    handler();
  });

export function subscribeToGraphChanges(
  onChange: () => void,
  listenTo: Listen = tauriListen,
): Subscription {
  let cancelled = false;
  let stop: Unlisten | null = null;

  const attach = async () => {
    try {
      const unlisten = await listenTo(GRAPH_CHANGED_EVENT, onChange);
      if (cancelled) unlisten();
      else stop = unlisten;
    } catch (error) {
      console.error("flare: could not subscribe to graph changes", error);
    }
  };
  void attach();

  return {
    cancel: () => {
      cancelled = true;
      stop?.();
      stop = null;
    },
  };
}
