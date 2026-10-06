import type { GraphSnapshot, Language } from "@/features/graph/graph-types";

import { luaSnapshot } from "./lua-fixture";

export const FIXTURE_SIZES = { small: 25, medium: 300, large: 2000 } as const;
export const GENERATED_NAMES = ["small", "medium", "large"] as const;
/** `lua` is a hand-shaped project rather than a generated one; see lua-fixture. */
export const FIXTURE_NAMES = [...GENERATED_NAMES, "lua"] as const;
export type FixtureSize = (typeof FIXTURE_NAMES)[number];
type GeneratedSize = (typeof GENERATED_NAMES)[number];

export function isFixtureSize(value: string | null): value is FixtureSize {
  return FIXTURE_NAMES.some((name) => name === value);
}

type Rng = () => number;

interface Folder {
  path: string;
  weight: number;
  language: Language;
  extension: string;
  group: "feature" | "shared" | "server" | "other";
}

const WORDS = [
  "auth", "session", "user", "profile", "card", "list", "table", "form", "field", "modal", "toast", "menu", "panel",
  "chart", "graph", "store", "query", "cache", "client", "parser", "token", "route", "layout", "theme", "icon",
  "search", "filter", "sort", "paginate", "upload", "export", "import", "sync", "queue", "worker", "logger",
  "config", "schema", "model", "view", "page", "header", "footer", "sidebar", "tab", "badge", "avatar", "tooltip",
  "input", "select", "button", "banner", "drawer", "wizard", "editor", "preview", "detail", "summary", "settings",
];

const FEATURE_NAMES = [
  "chat", "files", "graph", "terminal", "threads", "billing", "inbox", "search", "settings", "onboarding", "reports",
  "teams", "projects", "calendar", "notes", "alerts", "analytics", "audit", "orders", "catalog", "checkout", "media",
  "support", "admin", "profile", "feeds", "payments", "invoices", "contacts", "tasks", "boards", "labels", "reviews",
  "exports", "imports", "webhooks", "keys", "roles", "plans", "usage",
];

function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("cannot pick from an empty list");
  return item;
}

type FolderInput = Pick<Folder, "path" | "weight" | "group"> & Partial<Pick<Folder, "extension" | "language">>;

function folder({ path, weight, group, extension = "ts", language = "typescript" }: FolderInput): Folder {
  return { path, weight, group, extension, language };
}

function featureFolders(name: string, weight: number, rng: Rng): Folder[] {
  const base = `src/features/${name}`;
  const folders = [
    folder({ path: `${base}/components`, weight: weight * 0.42, group: "feature", extension: "tsx" }),
    folder({ path: `${base}/hooks`, weight: weight * 0.16, group: "feature" }),
    folder({ path: base, weight: weight * 0.2, group: "feature" }),
    folder({ path: `${base}/lib`, weight: weight * 0.22, group: "feature" }),
  ];
  if (weight > 14) folders.push(folder({ path: `${base}/components/forms`, weight: weight * 0.2, group: "feature", extension: "tsx" }));
  if (rng() < 0.4) folders.push(folder({ path: `${base}/api`, weight: weight * 0.14, group: "feature" }));
  return folders;
}

function buildFolders(total: number, rng: Rng): Folder[] {
  const featureCount = Math.max(2, Math.min(FEATURE_NAMES.length, Math.round(total / 52)));
  const featureShare = total * 0.62;
  const names = FEATURE_NAMES.slice(0, featureCount);
  const folders: Folder[] = [
    folder({ path: "src/shared/ui", weight: total * 0.07, group: "shared", extension: "tsx" }),
    folder({ path: "src/shared/lib", weight: total * 0.06, group: "shared" }),
    folder({ path: "src/shared/hooks", weight: total * 0.03, group: "shared" }),
    folder({ path: "src/app", weight: Math.max(2, total * 0.015), group: "other", extension: "tsx" }),
    folder({ path: "server/routes", weight: total * 0.06, group: "server" }),
    folder({ path: "server/services", weight: total * 0.05, group: "server" }),
    folder({ path: "server/db", weight: total * 0.025, group: "server" }),
  ];
  for (const name of names) folders.push(...featureFolders(name, (featureShare / featureCount) * (0.6 + rng() * 0.8), rng));
  if (total > 100) {
    folders.push(
      folder({ path: "scripts", weight: total * 0.012, group: "other", extension: "py", language: "python" }),
      folder({ path: "native/src", weight: total * 0.02, group: "other", extension: "rs", language: "rust" }),
      folder({ path: "tools/build", weight: total * 0.01, group: "other", extension: "js", language: "javascript" }),
    );
  }
  return folders;
}

function allocate(folders: readonly Folder[], total: number): Map<Folder, number> {
  const sum = folders.reduce((acc, item) => acc + item.weight, 0);
  const counts = new Map<Folder, number>();
  let assigned = 0;
  for (const item of folders) {
    const count = Math.max(1, Math.round((item.weight / sum) * total));
    counts.set(item, count);
    assigned += count;
  }
  const largest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (largest !== undefined) counts.set(largest[0], Math.max(1, largest[1] + total - assigned));
  return counts;
}

function fileName(rng: Rng, taken: Set<string>, item: Folder): string {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const stem = rng() < 0.45 ? `${pick(rng, WORDS)}-${pick(rng, WORDS)}` : pick(rng, WORDS);
    const id = `${item.path}/${stem}.${item.extension}`;
    if (!taken.has(id)) return id;
  }
  return `${item.path}/${pick(rng, WORDS)}-${taken.size}.${item.extension}`;
}

interface Built {
  nodes: GraphSnapshot["nodes"];
  byFolder: Map<string, string[]>;
  byGroup: Map<Folder["group"], string[]>;
}

function buildNodes(folders: readonly Folder[], counts: Map<Folder, number>, rng: Rng): Built {
  const nodes: GraphSnapshot["nodes"] = [];
  const byFolder = new Map<string, string[]>();
  const byGroup = new Map<Folder["group"], string[]>();
  const taken = new Set<string>();
  for (const item of folders) {
    const ids: string[] = [];
    for (let index = 0; index < (counts.get(item) ?? 0); index += 1) {
      const id = fileName(rng, taken, item);
      taken.add(id);
      ids.push(id);
      nodes.push({ id, language: item.language });
    }
    byFolder.set(item.path, ids);
    byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), ...ids]);
  }
  return { nodes, byFolder, byGroup };
}

function featureOf(id: string): string {
  const match = /^src\/features\/([^/]+)\//.exec(id);
  return match?.[1] ?? "";
}

function zipfPick(rng: Rng, ids: readonly string[]): string {
  const index = Math.floor(ids.length * rng() ** 2.4);
  return ids[Math.min(index, ids.length - 1)] ?? pick(rng, ids);
}

function targetFor(source: string, built: Built, rng: Rng): string | null {
  const roll = rng();
  const feature = featureOf(source);
  const siblings = feature === "" ? [] : [...built.byFolder.entries()].filter(([path]) => path.startsWith(`src/features/${feature}`));
  if (roll < 0.58 && siblings.length > 0) return zipfPick(rng, pick(rng, siblings)[1]);
  if (roll < 0.84) return zipfPick(rng, built.byGroup.get("shared") ?? []);
  if (roll < 0.92) return pick(rng, built.byGroup.get("feature") ?? []);
  return pick(rng, built.byGroup.get(source.startsWith("server/") ? "server" : "shared") ?? []);
}

function buildEdges(built: Built, rng: Rng): GraphSnapshot["edges"] {
  const seen = new Set<string>();
  const edges: GraphSnapshot["edges"] = [];
  for (const { id } of built.nodes) {
    const degree = rng() < 0.2 ? 0 : 1 + Math.floor(-Math.log(1 - rng()) * 0.9);
    for (let index = 0; index < degree; index += 1) {
      const target = targetFor(id, built, rng);
      const key = `${id}>${target ?? ""}`;
      if (target === null || target === id || seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: id, target });
    }
  }
  return edges;
}

export function generateSnapshot(size: FixtureSize, seed = 7): GraphSnapshot {
  return size === "lua" ? luaSnapshot() : generateProject(size, seed);
}

function generateProject(size: GeneratedSize, seed: number): GraphSnapshot {
  const total = FIXTURE_SIZES[size];
  const rng = createRng(seed + total);
  const folders = buildFolders(total, rng);
  const built = buildNodes(folders, allocate(folders, total), rng);
  return { root: `/lab/${size}`, nodes: built.nodes, edges: buildEdges(built, rng), warnings: [] };
}

export interface ScriptStep {
  kind: "read" | "edit" | "create" | "search";
  path?: string;
  detail?: string;
}

function neighboursOf(snapshot: GraphSnapshot, id: string): string[] {
  return snapshot.edges.flatMap((edge) => (edge.source === id ? [edge.target] : edge.target === id ? [edge.source] : []));
}

/** A believable agent walk: search, follow imports, edit a few files, create one. */
export function agentScript(snapshot: GraphSnapshot, seed = 3): ScriptStep[] {
  const rng = createRng(seed);
  const ids = snapshot.nodes.map((node) => node.id);
  let current = pick(rng, ids);
  const steps: ScriptStep[] = [{ kind: "search", detail: "useSession" }, { kind: "read", path: current }];
  for (let hop = 0; hop < 9; hop += 1) {
    const next = neighboursOf(snapshot, current);
    current = next.length > 0 ? pick(rng, next) : pick(rng, ids);
    const kind = hop % 4 === 3 ? "edit" : "read";
    steps.push({ kind, path: current });
  }
  steps.push({ kind: "create", path: pick(rng, ids) }, { kind: "edit", path: current });
  return steps;
}
