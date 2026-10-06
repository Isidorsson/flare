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

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hueSector(max: number, rgb: readonly [number, number, number], delta: number): number {
  const [red, green, blue] = rgb;
  if (max === red) return ((green - blue) / delta) % 6;
  return max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
}

export function toHsl(color: string): Hsl {
  const { r, g, b } = parseHex(color);
  const rgb: [number, number, number] = [r / 255, g / 255, b / 255];
  const max = Math.max(...rgb);
  const delta = max - Math.min(...rgb);
  const l = (max + Math.min(...rgb)) / 2;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  return { h: (hueSector(max, rgb, delta) * 60 + 360) % 360, s, l };
}

function hueChannel(p: number, q: number, hue: number): number {
  const t = (hue + 1) % 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function fromHsl({ h, s, l }: Hsl): string {
  const sat = clamp01(s);
  const light = clamp01(l);
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const hue = (((h % 360) + 360) % 360) / 360;
  const channels = [hueChannel(p, q, hue + 1 / 3), hueChannel(p, q, hue), hueChannel(p, q, hue - 1 / 3)];
  return `#${channels.map((channel) => channelToHex(channel * 255)).join("")}`;
}

export interface MuteOptions {
  readonly saturation: number;
  readonly lightness: number;
}

/** Pulls a vivid colour towards a calm one: keeps its hue, scales saturation and lightness. */
export function muteColor(color: string, options: MuteOptions): string {
  const { h, s, l } = toHsl(color);
  return fromHsl({ h, s: s * options.saturation, l: l * options.lightness });
}
