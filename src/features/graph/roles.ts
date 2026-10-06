export const ROLES = ["frontend", "database", "config", "code", "api", "tests", "docs", "assets"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  frontend: "Frontend",
  database: "Database",
  config: "Config",
  code: "Code",
  api: "API & server",
  tests: "Tests",
  docs: "Docs",
  assets: "Assets",
};

const TEST_SEGMENTS = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e", "__mocks__", "fixtures"]);
const CONFIG_SEGMENTS = new Set(["config", "configs", ".config", ".github", "scripts", "tools", "build", "ci"]);
const DATABASE_SEGMENTS = new Set([
  "db",
  "database",
  "migrations",
  "migration",
  "prisma",
  "drizzle",
  "schema",
  "schemas",
  "seeds",
  "seed",
  "models",
  "entities",
  "sql",
]);
const DOCS_SEGMENTS = new Set(["docs", "doc", "documentation"]);
const ASSET_SEGMENTS = new Set(["public", "assets", "static", "images", "img", "fonts", "icons"]);
const API_SEGMENTS = new Set([
  "api",
  "server",
  "routes",
  "controllers",
  "handlers",
  "services",
  "middleware",
  "backend",
  "rpc",
  "graphql",
  "endpoints",
  "trpc",
  "src-tauri",
]);
const FRONTEND_SEGMENTS = new Set([
  "components",
  "pages",
  "ui",
  "views",
  "app",
  "hooks",
  "styles",
  "layouts",
  "screens",
  "widgets",
  "client",
  "frontend",
  "web",
]);

const TEST_FILE = /(?:[._-](?:test|spec)\.[^.]+$)|(?:^test_)/;
const CONFIG_FILE = /^(?:[^/]*\.)?config\.[^.]+$|^(?:tsconfig|jsconfig|eslint|prettier|babel|webpack|rollup|jest|vitest|vite|playwright)[^/]*$/;
const FRONTEND_EXTENSIONS = new Set(["tsx", "jsx", "vue", "svelte", "css"]);
const DOC_EXTENSIONS = new Set(["md", "mdx"]);

interface PathParts {
  readonly segments: readonly string[];
  readonly file: string;
  readonly extension: string;
}

function splitPath(path: string): PathParts {
  const segments = path.toLowerCase().split("/");
  const file = segments.pop() ?? "";
  return { segments, file, extension: file.slice(file.lastIndexOf(".") + 1) };
}

function inFolder(parts: PathParts, names: ReadonlySet<string>): boolean {
  return parts.segments.some((segment) => names.has(segment));
}

type Rule = readonly [Role, (parts: PathParts) => boolean];

const RULES: readonly Rule[] = [
  ["tests", (parts) => inFolder(parts, TEST_SEGMENTS) || TEST_FILE.test(parts.file)],
  ["config", (parts) => inFolder(parts, CONFIG_SEGMENTS) || CONFIG_FILE.test(parts.file)],
  ["database", (parts) => inFolder(parts, DATABASE_SEGMENTS) || parts.extension === "sql"],
  ["docs", (parts) => inFolder(parts, DOCS_SEGMENTS) || DOC_EXTENSIONS.has(parts.extension)],
  ["assets", (parts) => inFolder(parts, ASSET_SEGMENTS)],
  ["api", (parts) => inFolder(parts, API_SEGMENTS)],
  ["frontend", (parts) => inFolder(parts, FRONTEND_SEGMENTS) || FRONTEND_EXTENSIONS.has(parts.extension)],
];

export function roleOf(path: string): Role {
  const parts = splitPath(path);
  for (const [role, matches] of RULES) {
    if (matches(parts)) return role;
  }
  return "code";
}

export type RoleCounts = Readonly<Record<Role, number>>;

export function emptyRoleCounts(): Record<Role, number> {
  return { frontend: 0, database: 0, config: 0, code: 0, api: 0, tests: 0, docs: 0, assets: 0 };
}

export function countRoles(roles: Iterable<Role>): RoleCounts {
  const counts = emptyRoleCounts();
  for (const role of roles) counts[role] += 1;
  return counts;
}

/** Ties resolve in ROLES order so the same folder always gets the same tint. */
export function dominantRole(roles: Iterable<Role>): Role {
  const counts = countRoles(roles);
  let best: Role = ROLES[0];
  for (const role of ROLES) {
    if (counts[role] > counts[best]) best = role;
  }
  return counts[best] === 0 ? "code" : best;
}
