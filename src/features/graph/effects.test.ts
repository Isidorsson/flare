import { describe, expect, test } from "bun:test";

import {
  FINISH_RING,
  routeMove,
  type HasEdge,
  isEffectActive,
  MAX_EFFECTS,
  PARTICLE_MS,
  particleProgress,
  pruneEffects,
  ringFrame,
  TOUCH_RING,
  type Effect,
  type ParticleEffect,
  type RingEffect,
} from "./effects";

function ring(startedAt: number, spec = TOUCH_RING): RingEffect {
  return { type: "ring", nodeId: "src/a.ts", color: "#ff9f4a", spec, startedAt };
}

function particle(startedAt: number): ParticleEffect {
  return { type: "particle", fromId: "src/a.ts", toId: "src/b.ts", color: "#78dceb", startedAt };
}

describe("shockwave ring", () => {
  test("touch ring starts at 6 px, 2.5 px wide and 0.8 opaque", () => {
    expect(ringFrame(ring(1000), 1000)).toEqual({ radius: 6, width: 2.5, alpha: 0.8 });
  });

  test("touch ring ends at 34 px, 0.5 px wide and transparent after 900 ms", () => {
    const end = ringFrame(ring(1000), 1900);
    expect(end.radius).toBeCloseTo(34, 9);
    expect(end.width).toBeCloseTo(0.5, 9);
    expect(end.alpha).toBeCloseTo(0, 9);
  });

  test("expands outward and fades monotonically in between", () => {
    let previous = ringFrame(ring(0), 0);
    for (let elapsed = 50; elapsed <= 900; elapsed += 50) {
      const frame = ringFrame(ring(0), elapsed);
      expect(frame.radius).toBeGreaterThan(previous.radius);
      expect(frame.width).toBeLessThan(previous.width);
      expect(frame.alpha).toBeLessThan(previous.alpha);
      previous = frame;
    }
  });

  test("the gold finish ring travels 6 to 66 px over 1400 ms", () => {
    expect(ringFrame(ring(0, FINISH_RING), 0).radius).toBe(6);
    expect(ringFrame(ring(0, FINISH_RING), 1400).radius).toBeCloseTo(66, 9);
    expect(isEffectActive(ring(0, FINISH_RING), 1399)).toBe(true);
    expect(isEffectActive(ring(0, FINISH_RING), 1400)).toBe(false);
  });

  test("a clock slightly behind the start does not produce a negative ring", () => {
    expect(ringFrame(ring(1000), 990)).toEqual({ radius: 6, width: 2.5, alpha: 0.8 });
  });
});

describe("edge particle", () => {
  test("travels from 0 to 1 over 500 ms and is then inactive", () => {
    expect(particleProgress(particle(100), 100)).toBe(0);
    expect(particleProgress(particle(100), 350)).toBe(0.5);
    expect(particleProgress(particle(100), 100 + PARTICLE_MS)).toBe(1);
    expect(isEffectActive(particle(100), 100 + PARTICLE_MS - 1)).toBe(true);
    expect(isEffectActive(particle(100), 100 + PARTICLE_MS)).toBe(false);
  });
});

describe("pruneEffects", () => {
  test("drops finished effects and keeps live ones in order", () => {
    const effects: Effect[] = [ring(0), particle(800), ring(1000)];
    expect(pruneEffects(effects, 1000)).toEqual([particle(800), ring(1000)]);
  });

  test("caps the number of live effects, keeping the newest", () => {
    const flood = Array.from({ length: MAX_EFFECTS + 20 }, (_, index) => ring(index));
    const kept = pruneEffects(flood, 0);
    expect(kept).toHaveLength(MAX_EFFECTS);
    expect(kept.at(-1)).toEqual(flood.at(-1));
  });
});

function edges(...pairs: [string, string][]): HasEdge {
  return (source, target) => pairs.some(([from, to]) => from === source && to === target);
}

describe("routeMove", () => {
  test("travels along an import edge in the direction of the move", () => {
    const hasEdge = edges(["src/a.ts", "src/b.ts"]);
    expect(routeMove(hasEdge, "src/a.ts", "src/b.ts")).toEqual({ kind: "edge", from: "src/a.ts", to: "src/b.ts" });
  });

  test("uses an edge pointing the other way, still travelling from the old file to the new one", () => {
    const hasEdge = edges(["src/a.ts", "src/b.ts"]);
    expect(routeMove(hasEdge, "src/b.ts", "src/a.ts")).toEqual({ kind: "edge", from: "src/b.ts", to: "src/a.ts" });
  });

  test("flies directly when the files are not connected", () => {
    expect(routeMove(edges(["src/a.ts", "src/b.ts"]), "src/a.ts", "src/c.ts")).toEqual({ kind: "direct" });
  });

  test("flies directly with no starting point, no destination, or no movement", () => {
    const hasEdge = edges(["src/a.ts", "src/a.ts"], ["src/a.ts", "src/b.ts"]);
    expect(routeMove(hasEdge, null, "src/b.ts").kind).toBe("direct");
    expect(routeMove(hasEdge, "src/a.ts", null).kind).toBe("direct");
    expect(routeMove(hasEdge, "src/a.ts", "src/a.ts").kind).toBe("direct");
  });
});
