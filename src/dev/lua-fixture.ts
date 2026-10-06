import type { GraphSnapshot } from "@/features/graph/graph-types";

/**
 * A server-script project shaped like the ones that showed doubled lines: the workspace root is one big hub folder
 * (`AIO_Server/`) with loose scripts beside it and many script folders around it; almost everything requires `AIO`,
 * and `QueueSystemServer.lua` has several importers, plain imports and two mutual requires.
 */
export const LUA_ROOT = "/lab/AIO_Server";
export const LUA_FOCUS_FILE = "QueueSystemServer.lua";

const ROOT_FILES = ["AIO.lua", "queue.lua", LUA_FOCUS_FILE, "ShaderEffectsDemo.lua", "LibCompress.lua", "bit53.lua"];
const LOOSE_SCRIPTS = 26;
const FOLDERS: readonly (readonly [string, number])[] = [
  ["Dungeons", 28],
  ["Dungeons/Bosses", 14],
  ["PvP", 22],
  ["Misc", 30],
  ["extensions", 18],
  ["progression", 16],
  ["hunger_system", 9],
  ["mass_purge", 8],
  ["extra_buttons_bar", 24],
  ["extra_buttons_bar/character advancement", 12],
  ["TutorialStuff", 10],
  ["SafeSlots", 8],
  ["EnchantReRoll", 6],
  ["general_server_luas", 26],
  ["hardcore_pvp", 11],
  ["Dep_LuaSrcDiet", 7],
];

type Edge = readonly [string, string];

function folderFiles(folder: string, count: number): string[] {
  const stem = folder.slice(folder.lastIndexOf("/") + 1).replace(/[^A-Za-z]/g, "");
  return Array.from({ length: count }, (_, index) => `${folder}/${stem}${String(index + 1).padStart(2, "0")}.lua`);
}

function looseScripts(): string[] {
  return Array.from({ length: LOOSE_SCRIPTS }, (_, index) => `Script${String(index + 1).padStart(2, "0")}.lua`);
}

/** Every third file leans on AIO, files lean on their folder's first file, and folders borrow from their neighbours. */
function everydayRequires(groups: readonly (readonly string[])[]): Edge[] {
  const edges: Edge[] = [];
  groups.forEach((files, group) => {
    const [lead] = files;
    const next = groups[(group + 1) % groups.length]?.[0];
    files.forEach((file, index) => {
      if (index % 3 === 0) edges.push([file, "AIO.lua"]);
      if (lead !== undefined && file !== lead && index % 2 === 1) edges.push([file, lead]);
      if (next !== undefined && index === files.length - 1) edges.push([file, next]);
    });
  });
  return edges;
}

function focusRequires(): Edge[] {
  const importers = ["Dungeons/Dungeons03.lua", "Dungeons/Dungeons07.lua", "PvP/PvP02.lua", "PvP/PvP05.lua", "Misc/Misc11.lua", "hardcore_pvp/hardcorepvp04.lua"];
  const mutual = ["Dungeons/Dungeons01.lua", "PvP/PvP01.lua"];
  return [
    ...importers.map((file): Edge => [file, LUA_FOCUS_FILE]),
    ...mutual.flatMap((file): Edge[] => [
      [file, LUA_FOCUS_FILE],
      [LUA_FOCUS_FILE, file],
    ]),
    [LUA_FOCUS_FILE, "AIO.lua"],
    [LUA_FOCUS_FILE, "queue.lua"],
    [LUA_FOCUS_FILE, "general_server_luas/generalserverluas09.lua"],
    ["AIO.lua", "queue.lua"],
    ["AIO.lua", "LibCompress.lua"],
    ["ShaderEffectsDemo.lua", "AIO.lua"],
  ];
}

export function luaSnapshot(): GraphSnapshot {
  const groups = [looseScripts(), ...FOLDERS.map(([folder, count]) => folderFiles(folder, count))];
  const ids = [...ROOT_FILES, ...groups.flat()];
  const known = new Set(ids);
  const seen = new Set<string>();
  const edges = [...focusRequires(), ...everydayRequires(groups)].filter(([source, target]) => {
    const key = `${source}>${target}`;
    if (source === target || !known.has(source) || !known.has(target) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    root: LUA_ROOT,
    nodes: ids.map((id) => ({ id, language: "lua" })),
    edges: edges.map(([source, target]) => ({ source, target })),
    warnings: [],
  };
}
