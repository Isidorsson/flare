import type { Pen } from "./canvas-draw";
import { collectFiles } from "./directory-tree";
import { drawGlow, fitEllipse, projectEllipse, withMinimumRadius, type Ellipse } from "./glow";
import type { GraphIndex } from "./graph-index";
import type { CodeGraph } from "./graph-model";
import type { ColorBy } from "./graph-store";
import { folderColor } from "./appearance";
import type { Palette } from "./palette";
import type { Point } from "./placement";
import type { Role } from "./roles";

const MIN_GLOW_RADIUS_PX = 26;
const GLOW_ALPHA = 0.15;
const NEUTRAL_GLOW_ALPHA = 0.08;
const NESTED_GLOW_FACTOR = 0.8;

export interface GlowSigma {
  graphToViewport: (point: Point) => Point;
  getDimensions: () => { width: number; height: number };
}

interface Group {
  readonly hub: string;
  readonly role: Role;
  readonly depth: number;
  readonly ellipse: Ellipse;
}

/** Soft coloured washes behind each folder's cluster: where the code lives, tinted by what it does. */
export class GlowLayer {
  private groups: readonly Group[] = [];
  private subtrees: ReadonlyMap<string, readonly string[]> = new Map();

  private readonly sigma: GlowSigma;

  constructor(sigma: GlowSigma) {
    this.sigma = sigma;
  }

  setIndex(index: GraphIndex | null): void {
    const subtrees = new Map<string, readonly string[]>();
    if (index !== null) {
      for (const hub of index.hubs) {
        const dir = index.folders.get(hub);
        if (hub !== "" && dir !== undefined) subtrees.set(hub, collectFiles(dir));
      }
    }
    this.subtrees = subtrees;
    this.groups = [];
  }

  refit(graph: CodeGraph, index: GraphIndex | null): void {
    if (index === null) {
      this.groups = [];
      return;
    }
    const groups: Group[] = [];
    for (const [hub, files] of this.subtrees) {
      const ellipse = fitEllipse(pointsOf(graph, files));
      if (ellipse === null) continue;
      groups.push({ hub, role: index.folderRoles.get(hub) ?? "code", depth: hub.split("/").length, ellipse });
    }
    this.groups = groups.sort((a, b) => b.ellipse.major * b.ellipse.minor - a.ellipse.major * a.ellipse.minor);
  }

  draw(pen: Pen | null, options: { colorBy: ColorBy; palette: Palette }): void {
    if (pen === null) return;
    const { width, height } = this.sigma.getDimensions();
    pen.clearRect(0, 0, width, height);
    for (const group of this.groups) {
      const shape = withMinimumRadius(projectEllipse(group.ellipse, (point) => this.sigma.graphToViewport(point)), MIN_GLOW_RADIUS_PX);
      const base = options.colorBy === "language" ? NEUTRAL_GLOW_ALPHA : GLOW_ALPHA;
      const alpha = group.depth > 1 ? base * NESTED_GLOW_FACTOR : base;
      drawGlow(pen, shape, glowColor(group, options), alpha);
    }
  }
}

function pointsOf(graph: CodeGraph, files: readonly string[]): Point[] {
  const points: Point[] = [];
  for (const id of files) {
    if (graph.hasNode(id)) points.push(graph.getNodeAttributes(id));
  }
  return points;
}

function glowColor(group: Group, options: { colorBy: ColorBy; palette: Palette }): string {
  const { palette, colorBy } = options;
  if (colorBy === "directory") return folderColor(palette, group.hub);
  return colorBy === "language" ? palette.edge : palette.roleHues[group.role];
}
