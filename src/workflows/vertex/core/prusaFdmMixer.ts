import type { RGB } from './types';

/**
 * Adapted from prusa3d/prusa-fdm-mixer (MIT), calibration v7.
 * Copyright (c) 2026 Ondrej Bartas (Prusa Research s.r.o.) and contributors.
 *
 * This local copy avoids an additional runtime dependency and keeps Color Mix Lab
 * deployable as a static browser app. It predicts the apparent colour of layer-
 * interleaved FDM filament mixtures. Do not replace this with a simple RGB
 * average: that is the failure mode that makes CMYWK mixes look brown/olive.
 */

export interface LAB {
  L: number;
  a: number;
  b: number;
}

export interface FilamentMixPart {
  rgb: RGB;
  ratio: number;
}

export interface FdmMixResult {
  rgb: RGB;
  lab: LAB;
}

interface V7Params {
  YN_N: number;
  L_BASE_SLOPE: number;
  L_BASE_INTERCEPT: number;
  L_KNEE: number;
  L_KNEE_SLOPE: number;
  C_SLOPE: number;
  C_INTERCEPT: number;
  HUE_CENTER: number;
  HUE_FALLOFF: number;
  HUE_PEAK: number;
  PEAK_STRENGTH: number;
}

const DEFAULT_V7_PARAMS: V7Params = {
  YN_N: 3.0,
  L_BASE_SLOPE: -0.0477,
  L_BASE_INTERCEPT: -2.112,
  L_KNEE: 15,
  L_KNEE_SLOPE: -0.06,
  C_SLOPE: 0.278,
  C_INTERCEPT: -15.58,
  HUE_CENTER: 210,
  HUE_FALLOFF: 30,
  HUE_PEAK: 10.38,
  PEAK_STRENGTH: 1.375,
};

const clamp255 = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)));

export function srgbToLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(channel: number): number {
  const x = Math.max(0, Math.min(1, channel));
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return v * 255;
}

function yuleNielsenMix(parts: FilamentMixPart[], n: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const part of parts) {
    r += Math.pow(srgbToLinear(part.rgb[0]), 1 / n) * part.ratio;
    g += Math.pow(srgbToLinear(part.rgb[1]), 1 / n) * part.ratio;
    b += Math.pow(srgbToLinear(part.rgb[2]), 1 / n) * part.ratio;
  }
  return [
    linearToSrgb(Math.pow(Math.max(0, r), n)),
    linearToSrgb(Math.pow(Math.max(0, g), n)),
    linearToSrgb(Math.pow(Math.max(0, b), n)),
  ];
}

export function rgbToXyz(rgb: RGB | [number, number, number]): { x: number; y: number; z: number } {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  return {
    x: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    y: r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    z: r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  };
}

export function xyzToLab(x: number, y: number, z: number): LAB {
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;
  const f = (t: number): number =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function rgbToLab(rgb: RGB | [number, number, number]): LAB {
  const xyz = rgbToXyz(rgb);
  return xyzToLab(xyz.x, xyz.y, xyz.z);
}

function labToXyz(lab: LAB): { x: number; y: number; z: number } {
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;
  const fy = (lab.L + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;
  const finv = (t: number): number =>
    Math.pow(t, 3) > 0.008856 ? Math.pow(t, 3) : (t - 16 / 116) / 7.787;
  return { x: xn * finv(fx), y: yn * finv(fy), z: zn * finv(fz) };
}

function xyzToRgb(x: number, y: number, z: number): [number, number, number] {
  return [
    linearToSrgb(x * 3.2404542 + y * -1.5371385 + z * -0.4985314),
    linearToSrgb(x * -0.969266 + y * 1.8760108 + z * 0.041556),
    linearToSrgb(x * 0.0556434 + y * -0.2040259 + z * 1.0572252),
  ];
}

export function labToRgb(lab: LAB): RGB {
  const xyz = labToXyz(lab);
  const rgb = xyzToRgb(xyz.x, xyz.y, xyz.z);
  return [clamp255(rgb[0]), clamp255(rgb[1]), clamp255(rgb[2])];
}

export function labChroma(lab: LAB): number {
  return Math.hypot(lab.a, lab.b);
}

export function labHueDegrees(lab: LAB): number {
  if (labChroma(lab) < 0.01) return 0;
  return ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;
}

export function deltaE76(a: LAB, b: LAB): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

export function hueDistanceDegrees(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function normaliseParts(parts: FilamentMixPart[]): FilamentMixPart[] {
  const cleaned = parts.filter((part) => part.ratio > 0);
  const total = cleaned.reduce((sum, part) => sum + part.ratio, 0);
  if (total <= 0) throw new Error('mixFilamentsRgb: ratios must sum to a positive value');
  return cleaned.map((part) => ({ rgb: part.rgb, ratio: part.ratio / total }));
}

export function mixFilamentsRgb(parts: FilamentMixPart[]): FdmMixResult {
  const normalized = normaliseParts(parts);
  for (const part of normalized) {
    if (part.ratio >= 0.9999) {
      const rgb: RGB = [clamp255(part.rgb[0]), clamp255(part.rgb[1]), clamp255(part.rgb[2])];
      return { rgb, lab: rgbToLab(rgb) };
    }
  }

  const params = DEFAULT_V7_PARAMS;
  const baseRgb = yuleNielsenMix(normalized, params.YN_N);
  const baseLab = rgbToLab(baseRgb);

  const Ls = normalized.map((part) => rgbToLab(part.rgb).L);
  const lGap = Math.max(...Ls) - Math.min(...Ls);

  const N = normalized.length;
  const ratioProduct = normalized.reduce((s, p) => s * p.ratio, 1);
  const wRaw = Math.pow(N, N) * ratioProduct;
  const w = Math.max(0, Math.min(1, wRaw)) * params.PEAK_STRENGTH;

  let dL = params.L_BASE_SLOPE * lGap + params.L_BASE_INTERCEPT;
  if (lGap > params.L_KNEE) dL += params.L_KNEE_SLOPE * (lGap - params.L_KNEE);
  const newL = baseLab.L + dL * w;

  const baseC = labChroma(baseLab);
  let aOut = baseLab.a;
  let bOut = baseLab.b;
  if (baseC >= 0.01) {
    const targetDC = (params.C_SLOPE * newL + params.C_INTERCEPT) * w;
    const newC = Math.max(0, baseC + targetDC);
    const scale = newC / baseC;
    aOut = baseLab.a * scale;
    bOut = baseLab.b * scale;
  }

  const newC = Math.hypot(aOut, bOut);
  if (newC >= 1) {
    const predHue = ((Math.atan2(bOut, aOut) * 180) / Math.PI + 360) % 360;
    const distFromCenter = Math.abs(predHue - params.HUE_CENTER);
    if (distFromCenter < params.HUE_FALLOFF) {
      const hCorr = params.HUE_PEAK * (1 - distFromCenter / params.HUE_FALLOFF) * w;
      const newHueRad = (((predHue + hCorr) % 360) * Math.PI) / 180;
      aOut = newC * Math.cos(newHueRad);
      bOut = newC * Math.sin(newHueRad);
    }
  }

  const lab: LAB = { L: newL, a: aOut, b: bOut };
  return { rgb: labToRgb(lab), lab };
}
