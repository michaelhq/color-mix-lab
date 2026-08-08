import type { ColourDifferenceMetric, RGB } from './types';

/**
 * Adapted from prusa3d/prusa-fdm-mixer (MIT), calibration v7.
 * Verified against the upstream TypeScript v7 implementation on 2026-08-08.
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

export function deltaE2000(lab1: LAB, lab2: LAB): number {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const avgL = (L1 + L2) / 2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;
  const avgC7 = Math.pow(avgC, 7);
  const twentyFive7 = Math.pow(25, 7);
  const G = 0.5 * (1 - Math.sqrt(avgC7 / (avgC7 + twentyFive7)));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) / 2;

  const h1p = ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360;
  const h2p = ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360;
  const avgHp =
    Math.abs(h1p - h2p) > 180
      ? (h1p + h2p + 360) / 2
      : (h1p + h2p) / 2;

  const T =
    1 -
    0.17 * Math.cos(((avgHp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * avgHp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * avgHp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * avgHp - 63) * Math.PI) / 180);

  let dhp = h2p - h1p;
  if (Math.abs(dhp) > 180) dhp -= dhp > 0 ? 360 : -360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dHp =
    2 * Math.sqrt(C1p * C2p) * Math.sin(((dhp / 2) * Math.PI) / 180);
  const SL =
    1 +
    (0.015 * Math.pow(avgL - 50, 2)) /
      Math.sqrt(20 + Math.pow(avgL - 50, 2));
  const SC = 1 + 0.045 * avgCp;
  const SH = 1 + 0.015 * avgCp * T;

  const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const avgCp7 = Math.pow(avgCp, 7);
  const RC = 2 * Math.sqrt(avgCp7 / (avgCp7 + twentyFive7));
  const RT = -RC * Math.sin((2 * dTheta * Math.PI) / 180);

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH),
  );
}

export function colourDistance(
  a: LAB,
  b: LAB,
  metric: ColourDifferenceMetric,
): number {
  return metric === 'ciede2000' ? deltaE2000(a, b) : deltaE76(a, b);
}

export function hueDistanceDegrees(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function normaliseParts(parts: FilamentMixPart[]): FilamentMixPart[] {
  if (parts.length === 0) {
    throw new Error('mixFilamentsRgb: parts must not be empty');
  }
  const total = parts.reduce((sum, part) => sum + part.ratio, 0);
  if (total <= 0) {
    throw new Error('mixFilamentsRgb: ratios must sum to a positive value');
  }
  return parts.map((part) => {
    if (part.ratio < 0) {
      throw new Error('mixFilamentsRgb: ratios must not be negative');
    }
    return {
      rgb: [
        clamp255(part.rgb[0]),
        clamp255(part.rgb[1]),
        clamp255(part.rgb[2]),
      ] as RGB,
      ratio: part.ratio / total,
    };
  });
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
  // Upstream calibration v7 converts the Yule-Nielsen result through 8-bit
  // sRGB before the empirical LAB corrections. Preserve that rounding step so
  // Color Mix Lab produces the same reference predictions.
  const baseLab = rgbToLab([
    clamp255(baseRgb[0]),
    clamp255(baseRgb[1]),
    clamp255(baseRgb[2]),
  ]);

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
