const SEPARATOR = /[\\/]/;
const TRAILING_SEPARATORS = /[\\/]+$/;

export function baseName(path: string): string {
  const trimmed = path.replace(TRAILING_SEPARATORS, "");
  const last = trimmed.split(SEPARATOR).at(-1);
  if (last !== undefined && last !== "") return last;
  return trimmed === "" ? path : trimmed;
}
