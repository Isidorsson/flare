interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export function parseHex(value: string): Rgb {
  const match = HEX_COLOR.exec(value.trim());
  if (match === null) {
    throw new Error(`expected a #rrggbb colour but got "${value}"`);
  }
  const [, r = "", g = "", b = ""] = match;
  return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) };
}

function channelToHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function mixColors(from: string, to: string, amount: number): string {
  const t = clamp01(amount);
  const a = parseHex(from);
  const b = parseHex(to);
  const mixed = {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
  return `#${channelToHex(mixed.r)}${channelToHex(mixed.g)}${channelToHex(mixed.b)}`;
}

export function withAlpha(color: string, alpha: number): string {
  const { r, g, b } = parseHex(color);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha).toFixed(3)})`;
}
