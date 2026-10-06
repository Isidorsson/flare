import { beforeEach, describe, expect, test } from "bun:test";

import { activityColor } from "./activity-palette";
import { withAlpha } from "./color-math";
import { AgentOverlay, type OverlaySigma } from "./agent-overlay";
import { FINISH_RING, TOUCH_RING, type ParticleEffect, type RingEffect } from "./effects";
import type { GraphApi } from "./graph-api";
import type { CodeGraph } from "./graph-model";
import { snapshotToGraph } from "./graph-sync";
import { createGraphStore, type GraphStore } from "./graph-store";
import { fixtureActivityPalette, fixturePalette } from "./palette-fixture";
import { RecordingPen } from "./pen-fixture";
import type { Point } from "./placement";

const ROOT = "C:\\work\\app";
const colors = fixtureActivityPalette();
const FRAME = 1000 / 60;

const sigma: OverlaySigma = {
  getDimensions: () => ({ width: 400, height: 300 }),
  graphToViewport: (point) => point,
  viewportToFramedGraph: (point) => ({ x: point.x / 100, y: point.y / 100 }),
  scaleSize: (size = 0) => size,
  getNodeDisplayData: () => ({ size: 4 }),
};

const time = { now: 1000 };
const now = () => time.now;

function makeStore(): GraphStore {
  const snapshot = {
    root: "C:/work/app",
    nodes: ["a", "b", "c", "d"].map((name) => ({ id: `src/${name}.ts`, language: "typescript" as const })),
    edges: [{ source: "src/a.ts", target: "src/b.ts" }],
    warnings: [],
  };
  const api: GraphApi = {
    build: () => Promise.resolve(snapshot),
    snapshot: () => Promise.resolve(snapshot),
    blastRadius: (path) => Promise.resolve({ origin: path, nodes: [] }),
    updateFile: () => Promise.resolve("unchanged"),
    removeFile: () => Promise.resolve("unchanged"),
  };
  return createGraphStore({ api, now });
}

const POSITIONS: ReadonlyMap<string, Point> = new Map([
  ["src/a.ts", { x: 100, y: 100 }],
  ["src/b.ts", { x: 300, y: 100 }],
  ["src/c.ts", { x: 100, y: 250 }],
  ["src/d.ts", { x: 300, y: 250 }],
]);

interface Harness {
  store: GraphStore;
  graph: CodeGraph;
  overlay: AgentOverlay;
  halos: RecordingPen;
  agent: RecordingPen;
  touch: (path: string, kind?: "read" | "edit" | "create", reduced?: boolean) => void;
  run: (frames: number, reduced?: boolean) => void;
}

async function harness(): Promise<Harness> {
  const store = makeStore();
  await store.getState().load(ROOT);
  const snapshot = store.getState().snapshot;
  if (snapshot === null) throw new Error("the fixture graph did not load");
  const graph = snapshotToGraph(snapshot, POSITIONS);
  const halos = new RecordingPen();
  const agent = new RecordingPen();
  const overlay = new AgentOverlay({
    sigma,
    graph,
    store,
    palette: fixturePalette(),
    colors,
    now,
    layers: { halos: () => halos, agent: () => agent },
  });
  const touch: Harness["touch"] = (path, kind = "read", reduced = false) => {
    store.getState().recordActivity({ path, kind });
    const event = store.getState().activity.lastEvent;
    if (event !== null) overlay.handleEvent(event, reduced);
  };
  const run: Harness["run"] = (frames, reduced = false) => {
    for (let frame = 0; frame < frames; frame += 1) {
      time.now += FRAME;
      overlay.step(FRAME, reduced);
    }
  };
  return { store, graph, overlay, halos, agent, touch, run };
}

function ringsOf(h: Harness): RingEffect[] {
  return h.overlay.effectsSnapshot().filter((effect) => effect.type === "ring");
}

function particlesOf(h: Harness): ParticleEffect[] {
  return h.overlay.effectsSnapshot().filter((effect) => effect.type === "particle");
}

let h: Harness;

beforeEach(async () => {
  time.now = 1000;
  h = await harness();
});

describe("touch events", () => {
  test("every touch of a graph node sends out a ring in the colour of the action", () => {
    h.touch("C:\\work\\app\\src\\a.ts", "edit");
    const [ring] = ringsOf(h);
    expect(ring?.nodeId).toBe("src/a.ts");
    expect(ring?.color).toBe(activityColor(colors, "edit"));
    expect(ring?.spec).toBe(TOUCH_RING);
  });

  test("paths outside the graph make no ring and no particle", () => {
    h.touch("C:\\elsewhere\\x.ts");
    h.touch("src/not-indexed.md");
    expect(h.overlay.effectsSnapshot()).toEqual([]);
  });

  test("moving along an import edge fires a particle in the new action's colour", () => {
    h.touch("src/a.ts");
    h.touch("src/b.ts", "edit");
    const [particle] = particlesOf(h);
    expect(particle).toMatchObject({ fromId: "src/a.ts", toId: "src/b.ts", color: activityColor(colors, "edit") });
  });

  test("also fires against the direction of the import", () => {
    h.touch("src/b.ts");
    h.touch("src/a.ts");
    expect(particlesOf(h)[0]).toMatchObject({ fromId: "src/b.ts", toId: "src/a.ts" });
  });

  test("files with no edge between them send only the comet", () => {
    h.touch("src/a.ts");
    h.touch("src/c.ts");
    expect(particlesOf(h)).toEqual([]);
    expect(ringsOf(h)).toHaveLength(2);
  });

  test("reduced motion shows no rings or particles but still retargets the comet", () => {
    h.touch("src/a.ts", "read", true);
    h.touch("src/b.ts", "read", true);
    expect(h.overlay.effectsSnapshot()).toEqual([]);
    h.overlay.step(FRAME, true);
    expect(h.overlay.cometCameraPoint()).toEqual({ x: 3, y: 1 });
  });

  test("finishing a turn sends a gold ring from the last node", () => {
    h.touch("src/c.ts", "edit");
    h.store.getState().setAgentStatus("done");
    const event = h.store.getState().activity.lastEvent;
    if (event !== null) h.overlay.handleEvent(event, false);
    const finish = ringsOf(h).find((ring) => ring.spec === FINISH_RING);
    expect(finish).toMatchObject({ nodeId: "src/c.ts", color: colors.finish });
  });

  test("a disk change rings its node but leaves the comet alone while the agent is busy", () => {
    h.touch("src/a.ts");
    h.overlay.step(FRAME, false);
    h.store.getState().recordActivity({ path: "src/d.ts", kind: "edit", source: "disk" });
    const event = h.store.getState().activity.lastEvent;
    if (event !== null) h.overlay.handleEvent(event, false);
    expect(ringsOf(h).map((ring) => ring.nodeId)).toContain("src/d.ts");
    h.run(200);
    expect(h.overlay.cometCameraPoint()).toEqual({ x: 1, y: 1 });
  });
});

describe("comet", () => {
  test("has no position before the agent has touched anything", () => {
    expect(h.overlay.cometCameraPoint()).toBeNull();
  });

  test("appears on the first file and then eases towards the next", () => {
    h.touch("src/a.ts");
    h.overlay.step(FRAME, false);
    expect(h.overlay.cometCameraPoint()).toEqual({ x: 1, y: 1 });
    h.touch("src/b.ts");
    h.overlay.step(FRAME, false);
    const point = h.overlay.cometCameraPoint();
    expect(point?.x).toBeGreaterThan(1);
    expect(point?.x).toBeLessThan(3);
    h.run(300);
    expect(h.overlay.cometCameraPoint()?.x).toBeCloseTo(3, 1);
  });

  test("a scene that mounts mid-run puts the comet on the file the agent last touched", () => {
    h.touch("src/c.ts");
    const late = new AgentOverlay({
      sigma,
      graph: h.graph,
      store: h.store,
      palette: fixturePalette(),
      colors,
      now,
      layers: { halos: () => null, agent: () => null },
    });
    late.step(FRAME, false);
    expect(late.cometCameraPoint()).toEqual({ x: 1, y: 2.5 });
  });

  test("keeps stepping while the agent works, and stops once it is idle and settled", () => {
    h.touch("src/a.ts");
    h.run(300);
    expect(h.overlay.step(FRAME, false)).toBe(true);
    h.store.getState().setAgentStatus("idle");
    expect(h.overlay.step(FRAME, false)).toBe(false);
  });

  test("under reduced motion nothing keeps the loop running once the comet has arrived", () => {
    h.touch("src/a.ts", "read", true);
    expect(h.overlay.step(FRAME, true)).toBe(false);
  });
});

describe("drawing", () => {
  test("shows a Claude pill with the current action while working", () => {
    h.touch("C:\\work\\app\\src\\a.ts", "edit");
    h.overlay.step(FRAME, false);
    h.overlay.draw(false);
    expect(h.agent.texts).toEqual(["Claude", "Editing · a.ts"]);
  });

  test("calls the agent Explore while it only reads and Claude once it changes things", () => {
    h.touch("src/a.ts", "read");
    h.overlay.draw(false);
    expect(h.agent.texts[0]).toBe("Explore");
    h.agent.texts.length = 0;
    h.touch("src/b.ts", "edit");
    h.overlay.draw(false);
    expect(h.agent.texts[0]).toBe("Claude");
  });

  test("shows Thinking and Done, and nothing when idle", () => {
    h.touch("src/a.ts");
    h.store.getState().setAgentStatus("thinking");
    h.overlay.draw(false);
    expect(h.agent.texts.at(-1)).toBe("Thinking");
    h.store.getState().setAgentStatus("done");
    h.overlay.draw(false);
    expect(h.agent.texts.at(-1)).toBe("Done");
    const drawn = h.agent.texts.length;
    h.store.getState().setAgentStatus("idle");
    h.overlay.draw(false);
    expect(h.agent.texts).toHaveLength(drawn);
  });

  test("still shows the label for a path outside the graph, without any node ring", () => {
    h.touch("C:\\elsewhere\\notes.txt");
    h.overlay.draw(false);
    expect(h.agent.texts).toEqual(["Explore", "Reading · notes.txt"]);
    expect(h.agent.arcs).toEqual([]);
  });

  test("draws nothing for selection when no file is selected", () => {
    h.overlay.draw(false);
    expect(h.agent.strokes.filter((stroke) => stroke.dashed)).toHaveLength(0);
  });

  test("ringed selection draws a dashed ring and an arc to each importer and import", () => {
    h.store.getState().select("src/b.ts");
    h.overlay.draw(false);
    const dashed = h.agent.strokes.filter((stroke) => stroke.dashed);
    expect(dashed).toHaveLength(2);
    expect(String(dashed[0]?.color)).toBe(withAlpha(fixturePalette().importer, 0.72));
  });

  test("uses the other colour for what the selected file imports", () => {
    h.store.getState().select("src/a.ts");
    h.overlay.draw(false);
    const arc = h.agent.strokes.find((stroke) => stroke.dashed);
    expect(String(arc?.color)).toBe(withAlpha(fixturePalette().imports, 0.72));
  });

  test("a blast origin takes the place of the selection", () => {
    h.store.getState().select("src/c.ts");
    h.store.setState({ blast: { origin: "src/b.ts", depths: null } });
    h.overlay.draw(false);
    expect(h.agent.arcs.some((arc) => Math.hypot(arc.x - 300, arc.y - 100) < 20)).toBe(true);
  });

  test("selection arcs hold still under reduced motion", () => {
    h.store.getState().select("src/b.ts");
    time.now = 5000;
    h.overlay.draw(true);
    const first = h.agent.strokes.length;
    time.now = 9000;
    h.overlay.draw(true);
    expect(h.agent.strokes.length).toBe(first * 2);
  });

  test("draws the dashed path through touched files, fading towards the oldest", () => {
    for (const name of ["a", "b", "c", "d"]) h.touch(`src/${name}.ts`);
    h.overlay.draw(false);
    const dashed = h.agent.strokes.filter((stroke) => stroke.dashed);
    expect(dashed).toHaveLength(3);
    const alphas = dashed.map((stroke) => {
      const match = /rgba\(\d+, \d+, \d+, ([\d.]+)\)/.exec(String(stroke.color));
      return Number(match?.[1]);
    });
    expect(alphas).toEqual([...alphas].sort((x, y) => x - y));
    expect(alphas[0]).toBeGreaterThan(0);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.55);
  });

  test("draws a thin ring around files changed this turn, until the next turn starts", () => {
    h.touch("src/a.ts", "edit");
    h.overlay.draw(true);
    const radii = h.agent.arcs.map((arc) => arc.radius);
    expect(radii).toContain(4 * 2 + 3);
    h.store.getState().startTurn();
    const next = new RecordingPen();
    const quiet = new AgentOverlay({
      sigma,
      graph: h.graph,
      store: h.store,
      palette: fixturePalette(),
      colors,
      now,
      layers: { halos: () => next, agent: () => next },
    });
    quiet.draw(true);
    expect(next.arcs.map((arc) => arc.radius)).not.toContain(4 * 2 + 3);
  });

  test("mid-flight it draws the shockwave, the neuron particle, the trail and the comet head", () => {
    h.touch("src/a.ts");
    h.run(20);
    h.touch("src/b.ts", "edit");
    h.run(6);
    h.overlay.draw(false);
    const ring = h.agent.arcs.find((arc) => arc.x === 300 && arc.y === 100 && arc.radius > 6 && arc.radius < 34);
    expect(ring).toBeDefined();
    expect(h.agent.arcs.some((arc) => arc.radius === 9)).toBe(true);
    expect(h.agent.strokes.some((stroke) => !stroke.dashed && stroke.width > 0 && stroke.width <= 4)).toBe(true);
    expect(h.agent.arcs.some((arc) => arc.radius === 3.2)).toBe(true);
  });

  test("static highlights only under reduced motion: no rings, trail or particles", () => {
    h.touch("src/a.ts", "edit", true);
    h.touch("src/b.ts", "edit", true);
    h.run(3, true);
    h.overlay.draw(true);
    const radii = h.agent.arcs.map((arc) => arc.radius);
    expect(radii).not.toContain(9);
    expect(h.agent.strokes.filter((stroke) => !stroke.dashed && stroke.width < 4 && stroke.width > 1)).toEqual([]);
  });

  test("glows touched nodes behind the node layer", () => {
    h.touch("src/a.ts", "edit");
    h.overlay.draw(false);
    expect(h.halos.arcs.some((arc) => arc.x === 100 && arc.y === 100)).toBe(true);
  });
});
