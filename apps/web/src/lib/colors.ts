// Per-activity colour algorithm, ported verbatim from the "Roganizo Web A" design:
// a deterministic hue per title plus a lightness nudge until contrast >= 4.5.

// English names map to the same hues so demo colours stay stable across languages.
const HUES: Record<string, number> = {
  Ciencias: 155,
  Science: 155,
  Matemática: 232,
  Maths: 232,
  Historia: 32,
  History: 32,
  Biología: 118,
  Biology: 118,
  Física: 285,
  Physics: 285,
  Inglés: 198,
  English: 198,
  Almuerzo: 58,
  Lunch: 58,
  Estudiar: 178,
  Study: 178,
  Gimnasio: 12,
  Gym: 12,
};

export const hueFor = (t: string): number =>
  HUES[t] !== undefined
    ? HUES[t]
    : Math.abs([...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % 360;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function lum(rgb: [number, number, number]): number {
  const f = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const INK_DARK: [number, number, number] = [15, 20, 24];
const INK_LIGHT: [number, number, number] = [244, 246, 246];

export interface Category {
  bg: string;
  fg: string;
  edge: string;
  stackBg: string;
}

export function category(title: string, theme: "dark" | "light", forcedHue?: number): Category {
  const h = forcedHue ?? hueFor(title);
  const s = theme === "dark" ? 40 : 56;
  let l = theme === "dark" ? 29 : 84;
  let rgb = hslToRgb(h, s, l);
  let ink = ratio(rgb, INK_LIGHT) >= ratio(rgb, INK_DARK) ? INK_LIGHT : INK_DARK;
  let guard = 0;
  while (ratio(rgb, ink) < 4.5 && guard++ < 20) {
    l += ink === INK_LIGHT ? -2 : 2;
    rgb = hslToRgb(h, s, l);
    ink = ratio(rgb, INK_LIGHT) >= ratio(rgb, INK_DARK) ? INK_LIGHT : INK_DARK;
  }
  return {
    bg: `hsl(${h} ${s}% ${l}%)`,
    fg: `rgb(${ink.join(",")})`,
    edge: `hsl(${h} ${theme === "dark" ? 42 : 48}% ${theme === "dark" ? 55 : 42}%)`,
    stackBg: ink === INK_LIGHT ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)",
  };
}
