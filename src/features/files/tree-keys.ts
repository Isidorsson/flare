export type TreeKeyAction = "next" | "previous" | "toggle";

interface TreeRowState {
  isDir: boolean;
  isOpen: boolean;
}

/** Arrow-key behaviour of the file tree: Up/Down move, Right opens and Left closes a folder. */
export function treeKeyAction(key: string, row: TreeRowState): TreeKeyAction | null {
  if (key === "ArrowDown") return "next";
  if (key === "ArrowUp") return "previous";
  if (!row.isDir) return null;
  if (key === "ArrowRight" && !row.isOpen) return "toggle";
  if (key === "ArrowLeft" && row.isOpen) return "toggle";
  return null;
}
