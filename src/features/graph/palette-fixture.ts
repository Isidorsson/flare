import { readActivityPalette, type ActivityPalette } from "./activity-palette";
import { readPalette, type Palette, type ReadToken } from "./palette";

const tokensCss = await Bun.file(new URL("../../styles/tokens.css", import.meta.url)).text();

export const readTokenFromCss: ReadToken = (name) => {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(tokensCss);
  return match?.[1] ?? "";
};

export function fixturePalette(): Palette {
  return readPalette(readTokenFromCss);
}

export function fixtureActivityPalette(): ActivityPalette {
  return readActivityPalette(readTokenFromCss);
}
