export type MenuColumn = "models" | "efforts";

const COLUMN_BY_ROLE: Record<string, MenuColumn> = {
  menuitem: "models",
  menuitemradio: "efforts",
};

/** The column a focused menu entry belongs to, from its ARIA role. */
export function columnOfRole(role: string | null): MenuColumn | null {
  return role === null ? null : (COLUMN_BY_ROLE[role] ?? null);
}

/**
 * The model column opens into its efforts with Right and the efforts go back with Left. Focus moving between
 * models would otherwise change which model the effort column belongs to, so keyboard users could never reach it.
 */
export function columnAfterArrow(key: string, from: MenuColumn): MenuColumn | null {
  if (from === "models" && key === "ArrowRight") return "efforts";
  if (from === "efforts" && key === "ArrowLeft") return "models";
  return null;
}
