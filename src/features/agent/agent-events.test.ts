import { describe, expect, mock, spyOn, test } from "bun:test";

import type { BridgeEvent } from "@flare/protocol";

import { createAgentEventBus, type AgentEventListener } from "./agent-events";

const readEvent: BridgeEvent = { type: "file.read", toolUseId: "t1", path: "C:/work/a.ts" };

describe("agent event bus", () => {
  test("delivers published events to every subscriber in order", () => {
    const bus = createAgentEventBus();
    const first: BridgeEvent[] = [];
    const second: BridgeEvent[] = [];
    bus.subscribe((event) => first.push(event));
    bus.subscribe((event) => second.push(event));

    bus.publish(readEvent);
    bus.publish({ type: "assistant.delta", text: "x" });

    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
  });

  test("stops delivering after unsubscribe", () => {
    const bus = createAgentEventBus();
    const listener = mock<AgentEventListener>(() => undefined);
    const unsubscribe = bus.subscribe(listener);

    bus.publish(readEvent);
    unsubscribe();
    bus.publish(readEvent);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("keeps delivering to other listeners when one throws, and reports the failure", () => {
    const bus = createAgentEventBus();
    const reported = spyOn(console, "error").mockImplementation(() => undefined);
    const survivor = mock<AgentEventListener>(() => undefined);
    bus.subscribe(() => {
      throw new Error("listener bug");
    });
    bus.subscribe(survivor);

    bus.publish(readEvent);

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledTimes(1);
    reported.mockRestore();
  });

  test("lets a listener unsubscribe itself while an event is being delivered", () => {
    const bus = createAgentEventBus();
    const later = mock<AgentEventListener>(() => undefined);
    const unsubscribe = bus.subscribe(() => {
      unsubscribe();
    });
    bus.subscribe(later);

    bus.publish(readEvent);

    expect(later).toHaveBeenCalledTimes(1);
  });
});
