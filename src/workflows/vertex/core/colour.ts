import type { ColourAdjustments, RGB, RGBA } from './types';

export const clamp255 = (x: number): number => Math.max(0, Math.min(255, Math.round(x)));

export function rgbToHex(rgb: RGB): string {
  return '#' + rgb.map(v => clamp255(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function parseHexColour(input: string): RGBA | null {
  const m = input.trim().match(/^#?([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
  if (h.length === 6) h += 'FF';
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    parseInt(h.slice(6, 8), 16),
  ];
}

export function effectiveRgbFromRgba(rgba: RGBA, background: RGB = [255, 255, 255]): RGB {
  const a = rgba[3] / 255;
  return [
    clamp255(a * rgba[0] + (1 - a) * background[0]),
    clamp255(a * rgba[1] + (1 - a) * background[1]),
    clamp255(a * rgba[2] + (1 - a) * background[2]),
  ];
}

function rgbToHsl(rgb: RGB): [number, number, number] {
  const [r, g, b] = rgb.map(v => v / 255) as RGB;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  const hk = h / 360;
  if (s === 0) {
    const v = clamp255(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    clamp255(hue2rgb(p, q, hk + 1 / 3) * 255),
    clamp255(hue2rgb(p, q, hk) * 255),
    clamp255(hue2rgb(p, q, hk - 1 / 3) * 255),
  ];
}

export function luminance(rgb: RGB): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function saturation(rgb: RGB): number {
  return rgbToHsl(rgb)[1];
}

export function adjustColour(rgb: RGB, adj: ColourAdjustments): RGB {
  let [r, g, b] = rgb.map(v => v / 255) as [number, number, number];
  if (adj.gamma && Math.abs(adj.gamma - 1) > 1e-6) {
    const inv = 1 / adj.gamma;
    r = Math.pow(r, inv); g = Math.pow(g, inv); b = Math.pow(b, inv);
  }
  const br = adj.brightness / 100;
  r += br; g += br; b += br;
  const contrast = 1 + adj.contrast / 100;
  r = (r - 0.5) * contrast + 0.5;
  g = (g - 0.5) * contrast + 0.5;
  b = (b - 0.5) * contrast + 0.5;
  const temp = adj.temperature / 100;
  r += temp * 0.08;
  b -= temp * 0.08;
  const tint = adj.tint / 100;
  r += tint * 0.04;
  b += tint * 0.04;
  g -= tint * 0.07;
  let out: RGB = [clamp255(r * 255), clamp255(g * 255), clamp255(b * 255)];
  let [h, s, l] = rgbToHsl(out);
  h += adj.hue;
  s = Math.max(0, Math.min(1, s * (1 + adj.saturation / 100)));
  out = hslToRgb(h, s, l);
  return out;
}

export function squaredDistance(a: RGB, b: RGB): number {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export const defaultAdjustments: ColourAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  hue: 0,
  tint: 0,
  gamma: 1,
};
