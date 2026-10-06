/** A CSS anchor name that is unique per React id; the colons in ids are not valid in a dashed ident. */
export function anchorNameFor(prefix: string, reactId: string): string {
  return `--${prefix}-${reactId.replaceAll(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** An element can carry several anchor names, so adding one must keep the names it already has. */
export function addAnchorName(existing: string | undefined, anchor: string): string {
  return existing === undefined || existing === "none" ? anchor : `${existing}, ${anchor}`;
}
