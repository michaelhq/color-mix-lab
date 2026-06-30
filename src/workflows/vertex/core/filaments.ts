import type { Filament, PaletteEntry, PhysicalSlot, RGB } from './types';
import { effectiveRgbFromRgba, luminance, parseHexColour, rgbToHex, saturation, squaredDistance } from './colour';

export function parseFilamentList(text: string, alphaBackground: RGB = [255, 255, 255]): Filament[] {
  const lines = text.split(/\r?\n/);
  const result: Filament[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(';').map(p => p.trim()).filter(Boolean);
    const hexPart = parts.find(p => /#?[0-9a-fA-F]{3,4}([0-9a-fA-F]{3,4})?$/.test(p));
    if (!hexPart) continue;
    const rgba = parseHexColour(hexPart);
    if (!rgba) continue;
    const idx = parts.indexOf(hexPart);
    let name = parts.slice(0, idx).join('; ').trim();
    let type = '';
    if (idx >= 2) {
      type = parts[idx - 1];
      name = parts.slice(0, idx - 1).join('; ').trim();
    } else {
      const m = name.match(/\b(PLA\+?|PETG|ABS|ASA|TPU|PC|PA|NYLON)\b/i);
      type = m ? m[1].toUpperCase() : '';
    }
    if (!name) name = `Filament ${rgbToHex([rgba[0], rgba[1], rgba[2]])}`;
    result.push({
      name,
      type,
      rgb: [rgba[0], rgba[1], rgba[2]],
      rgba,
      effectiveRgb: effectiveRgbFromRgba(rgba, alphaBackground),
      sourceLine: raw,
    });
  }
  return result;
}

export type PhysicalPresetGroup = 'classic' | 'gamut' | 'tone' | 'greyscale';

export const physicalColourPresets: Record<string, RGB[]> = {
  CMYWK: [[0, 255, 255], [255, 0, 255], [255, 255, 0], [255, 255, 255], [0, 0, 0]],
  CMYW: [[0, 255, 255], [255, 0, 255], [255, 255, 0], [255, 255, 255]],
  CMW: [[0, 255, 255], [255, 0, 255], [255, 255, 255]],
  BRYWK: [[0, 101, 170], [194, 0, 25], [234, 189, 0], [255, 255, 255], [0, 0, 0]],
  BRYW: [[0, 101, 170], [194, 0, 25], [234, 189, 0], [255, 255, 255]],
  BRY: [[0, 101, 170], [194, 0, 25], [234, 189, 0]],

  // Gamut extensions: add saturated spot colours that are hard to approximate with the base set.
  'CMYWK+R': [[0, 255, 255], [255, 0, 255], [255, 255, 0], [255, 255, 255], [0, 0, 0], [255, 0, 0]],
  'CMYWK+RG': [[0, 255, 255], [255, 0, 255], [255, 255, 0], [255, 255, 255], [0, 0, 0], [255, 0, 0], [0, 255, 0]],
  'CMYWK+RGB': [[0, 255, 255], [255, 0, 255], [255, 255, 0], [255, 255, 255], [0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]],
  'BRYWK+G': [[0, 101, 170], [194, 0, 25], [234, 189, 0], [255, 255, 255], [0, 0, 0], [35, 145, 45]],
  'BRYWK+GC': [[0, 101, 170], [194, 0, 25], [234, 189, 0], [255, 255, 255], [0, 0, 0], [35, 145, 45], [0, 210, 210]],
  'BRYWK+GCM': [[0, 101, 170], [194, 0, 25], [234, 189, 0], [255, 255, 255], [0, 0, 0], [35, 145, 45], [0, 210, 210], [220, 0, 180]],

  // Tone-smoothing extensions: add greys to reduce harsh light/dark layer jumps.
  'CMYWK+Grey': [[0, 255, 255], [255, 0, 255], [255, 255, 0], [255, 255, 255], [0, 0, 0], [128, 128, 128]],
  'CMYWK+LightGrey+DarkGrey': [[0, 255, 255], [255, 0, 255], [255, 255, 0], [255, 255, 255], [0, 0, 0], [192, 192, 192], [64, 64, 64]],
  'CMYWK+LightGrey+Grey+DarkGrey': [[0, 255, 255], [255, 0, 255], [255, 255, 0], [255, 255, 255], [0, 0, 0], [192, 192, 192], [128, 128, 128], [64, 64, 64]],
  'BRYWK+Grey': [[0, 101, 170], [194, 0, 25], [234, 189, 0], [255, 255, 255], [0, 0, 0], [128, 128, 128]],
  'BRYWK+LightGrey+DarkGrey': [[0, 101, 170], [194, 0, 25], [234, 189, 0], [255, 255, 255], [0, 0, 0], [192, 192, 192], [64, 64, 64]],
  'BRYWK+LightGrey+Grey+DarkGrey': [[0, 101, 170], [194, 0, 25], [234, 189, 0], [255, 255, 255], [0, 0, 0], [192, 192, 192], [128, 128, 128], [64, 64, 64]],

  '5G': [[255, 255, 255], [192, 192, 192], [128, 128, 128], [64, 64, 64], [0, 0, 0]],
  '4G': [[255, 255, 255], [170, 170, 170], [85, 85, 85], [0, 0, 0]],
  '3G': [[255, 255, 255], [128, 128, 128], [0, 0, 0]],
};

export const physicalColourPresetColourNames: Record<string, string[]> = {
  CMYWK: ['Cyan', 'Magenta', 'Yellow', 'White', 'Black'],
  CMYW: ['Cyan', 'Magenta', 'Yellow', 'White'],
  CMW: ['Cyan', 'Magenta', 'White'],
  BRYWK: ['Blue', 'Red', 'Yellow', 'White', 'Black'],
  BRYW: ['Blue', 'Red', 'Yellow', 'White'],
  BRY: ['Blue', 'Red', 'Yellow'],
  'CMYWK+R': ['Cyan', 'Magenta', 'Yellow', 'White', 'Black', 'Red'],
  'CMYWK+RG': ['Cyan', 'Magenta', 'Yellow', 'White', 'Black', 'Red', 'Green'],
  'CMYWK+RGB': ['Cyan', 'Magenta', 'Yellow', 'White', 'Black', 'Red', 'Green', 'Blue'],
  'BRYWK+G': ['Blue', 'Red', 'Yellow', 'White', 'Black', 'Green'],
  'BRYWK+GC': ['Blue', 'Red', 'Yellow', 'White', 'Black', 'Green', 'Cyan'],
  'BRYWK+GCM': ['Blue', 'Red', 'Yellow', 'White', 'Black', 'Green', 'Cyan', 'Magenta'],
  'CMYWK+Grey': ['Cyan', 'Magenta', 'Yellow', 'White', 'Black', 'Grey'],
  'CMYWK+LightGrey+DarkGrey': ['Cyan', 'Magenta', 'Yellow', 'White', 'Black', 'Light Grey', 'Dark Grey'],
  'CMYWK+LightGrey+Grey+DarkGrey': ['Cyan', 'Magenta', 'Yellow', 'White', 'Black', 'Light Grey', 'Grey', 'Dark Grey'],
  'BRYWK+Grey': ['Blue', 'Red', 'Yellow', 'White', 'Black', 'Grey'],
  'BRYWK+LightGrey+DarkGrey': ['Blue', 'Red', 'Yellow', 'White', 'Black', 'Light Grey', 'Dark Grey'],
  'BRYWK+LightGrey+Grey+DarkGrey': ['Blue', 'Red', 'Yellow', 'White', 'Black', 'Light Grey', 'Grey', 'Dark Grey'],
  '5G': ['White', 'Light Grey', 'Grey', 'Dark Grey', 'Black'],
  '4G': ['White', 'Light Grey', 'Dark Grey', 'Black'],
  '3G': ['White', 'Grey', 'Black'],
};

export const physicalColourPresetGroups: Record<string, PhysicalPresetGroup> = {
  CMYWK: 'classic',
  CMYW: 'classic',
  CMW: 'classic',
  BRYWK: 'classic',
  BRYW: 'classic',
  BRY: 'classic',
  'CMYWK+R': 'gamut',
  'CMYWK+RG': 'gamut',
  'CMYWK+RGB': 'gamut',
  'BRYWK+G': 'gamut',
  'BRYWK+GC': 'gamut',
  'BRYWK+GCM': 'gamut',
  'CMYWK+Grey': 'tone',
  'CMYWK+LightGrey+DarkGrey': 'tone',
  'CMYWK+LightGrey+Grey+DarkGrey': 'tone',
  'BRYWK+Grey': 'tone',
  'BRYWK+LightGrey+DarkGrey': 'tone',
  'BRYWK+LightGrey+Grey+DarkGrey': 'tone',
  '5G': 'greyscale',
  '4G': 'greyscale',
  '3G': 'greyscale',
};

export const presetNames = Object.keys(physicalColourPresets);

export function presetSlotCount(name: string): number {
  return (physicalColourPresets[name] || physicalColourPresets.CMYWK).length;
}

export function presetNamesForExtruderCount(count: number): string[] {
  // Only expose presets that match the requested slot count exactly.
  // The UI handles 6-8 slot expansions via base preset + extension strategy.
  return presetNames.filter((name) => presetSlotCount(name) === count);
}

export function filamentsFromPreset(
  name: string,
  count: number,
  colourNameMapper: (token: string) => string = (token) => token,
): Filament[] {
  const rgbs = (physicalColourPresets[name] || physicalColourPresets.CMYWK).slice(0, count);
  const colourNames = physicalColourPresetColourNames[name] || [];
  return rgbs.map((rgb, i) => {
    const colourName = colourNames[i] || `E${i + 1}`;
    return {
      name: colourNameMapper(colourName),
      type: '',
      rgb,
      effectiveRgb: rgb,
      sourceLine: `${name} ${colourName}; ${rgbToHex(rgb)}`,
    };
  });
}

export function filamentsFromHexText(text: string, count: number, alphaBackground: RGB = [255, 255, 255]): Filament[] {
  const matches = text.match(/#?[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/g) || [];
  return matches.slice(0, count).flatMap((match, index) => {
    const rgba = parseHexColour(match);
    if (!rgba) return [];
    const rgb: RGB = [rgba[0], rgba[1], rgba[2]];
    return [{
      name: `Manual E${index + 1}`,
      type: '',
      rgb,
      rgba,
      effectiveRgb: effectiveRgbFromRgba(rgba, alphaBackground),
      sourceLine: match,
    }];
  });
}

export function filamentsFromTemplateColours(colours: RGB[], count: number): Filament[] {
  return colours.slice(0, count).map((rgb, index) => ({
    name: `Template E${index + 1}`,
    type: '',
    rgb,
    effectiveRgb: rgb,
    sourceLine: rgbToHex(rgb),
  }));
}

export interface SuggestionOptions {
  saturationPenalty: number;
  diversityPenalty: number;
  balance: number;
  weightExponent: number;
  neutralWeight: number;
  maxComponents: 1 | 2 | 3;
  ratioStepPercent: number;
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [[]];
  if (size > items.length) return [];
  const out: T[][] = [];
  const rec = (start: number, current: T[]) => {
    if (current.length === size) {
      out.push([...current]);
      return;
    }
    for (let i = start; i <= items.length - (size - current.length); i++) {
      current.push(items[i]);
      rec(i + 1, current);
      current.pop();
    }
  };
  rec(0, []);
  return out;
}

function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) m[r][j] -= factor * m[col][j];
    }
  }
  return m.map(row => row[n]);
}

function constrainedMixForSubset(target: [number, number, number], subset: Filament[]): number[] | null {
  const n = subset.length;
  if (n === 1) return [1];

  const size = n + 1;
  const mat = Array.from({ length: size }, () => Array(size).fill(0));
  const rhs = Array(size).fill(0);

  for (let i = 0; i < n; i++) {
    const ai = subset[i].effectiveRgb.map(v => v / 255) as [number, number, number];
    for (let j = 0; j < n; j++) {
      const aj = subset[j].effectiveRgb.map(v => v / 255) as [number, number, number];
      mat[i][j] = 2 * (ai[0] * aj[0] + ai[1] * aj[1] + ai[2] * aj[2]);
    }
    mat[i][n] = 1;
    mat[n][i] = 1;
    rhs[i] = 2 * (ai[0] * target[0] + ai[1] * target[1] + ai[2] * target[2]);
  }
  rhs[n] = 1;

  const solution = solveLinearSystem(mat, rhs);
  if (!solution) return null;
  let weights = solution.slice(0, n);
  if (weights.some(w => w < -1e-8)) return null;
  weights = weights.map(w => Math.max(0, w));
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return null;
  return weights.map(w => w / sum);
}

const BLEND_PERCENT_UNIT = 5;
const BLEND_TOTAL_UNITS = Math.round(100 / BLEND_PERCENT_UNIT);

function stepPercentToUnits(stepPercent: number): number {
  const safeStep = Number.isFinite(stepPercent) ? stepPercent : 5;
  return Math.max(1, Math.round(safeStep / BLEND_PERCENT_UNIT));
}

const snappingCompositionCache = new Map<string, number[][]>();

function buildSnappingCompositions(parts: number, totalUnits: number, stepUnits: number): number[][] {
  const cacheKey = `${parts}|${totalUnits}|${stepUnits}`;
  const cached = snappingCompositionCache.get(cacheKey);
  if (cached) return cached;

  const allowedOffGridComponents = totalUnits % stepUnits === 0 ? 0 : 1;
  const out: number[][] = [];
  const seen = new Set<string>();
  const addCounts = (counts: number[]) => {
    if (counts.length !== parts) return;
    const positive = counts.filter(count => count > 0);
    if (positive.length === 0) return;
    const positiveGcd = positive.reduce((acc, count) => {
      let a = Math.abs(Math.round(acc));
      let b = Math.abs(Math.round(count));
      while (b !== 0) {
        const t = b;
        b = a % b;
        a = t;
      }
      return a || 1;
    }, positive[0] ?? 1);
    const key = counts.map(count => count > 0 ? Math.round(count / positiveGcd) : 0).join(":");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(counts);
  };

  const rec = (remainingParts: number, remainingUnits: number, current: number[]) => {
    if (remainingParts === 1) {
      const counts = [...current, remainingUnits];
      const positive = counts.filter(count => count > 0);
      if (positive.length === 0) return;
      if (positive.some(count => count < stepUnits)) return;
      const offGrid = positive.filter(count => count % stepUnits !== 0).length;
      if (offGrid <= allowedOffGridComponents) addCounts(counts);
      return;
    }

    for (let count = 0; count <= remainingUnits; count++) {
      rec(remainingParts - 1, remainingUnits - count, [...current, count]);
    }
  };

  rec(parts, totalUnits, []);

  // Keep filament suggestions aligned with the virtual-extruder planner: all
  // printable recipes use 5% steps, except the equal three-colour 1:1:1 recipe.
  // Two-colour thirds are not PrusaSlicer-style UI recipes; nearby 35/65 and
  // 65/35 mixes are evaluated by the 5% grid.
  if (parts === 3) {
    addCounts([1, 1, 1]);
  }

  snappingCompositionCache.set(cacheKey, out);
  return out;
}

interface FilamentSuggestionScoreCache {
  mixScores: Map<string, { score: number; rgbError: number; satPenalty: number }>;
  filamentKeys: Map<Filament, string>;
}

function filamentScoreKey(filament: Filament, fallbackIndex: number): string {
  return `${fallbackIndex}|${filament.name}|${filament.type}|${rgbToHex(filament.effectiveRgb)}|${filament.sourceLine}`;
}

function paletteScoreKey(rgb: RGB): string {
  return rgbToHex(rgb);
}

function subsetScoreKey(subset: Filament[], cache: FilamentSuggestionScoreCache): string {
  return subset
    .map((filament) => cache.filamentKeys.get(filament) || `${filament.name}|${rgbToHex(filament.effectiveRgb)}`)
    .sort()
    .join('+');
}

function snapRatiosToStep(weights: number[], stepPercent: number): number[] {
  const totalUnits = BLEND_TOTAL_UNITS;
  const stepUnits = stepPercentToUnits(stepPercent);
  const raw = weights.map(w => Math.max(0, w) * totalUnits);
  const compositions = buildSnappingCompositions(weights.length, totalUnits, stepUnits);

  let best = compositions[0] ?? raw.map(() => 0);
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of compositions) {
    const score = candidate.reduce((sum, count, index) => {
      const delta = count - (raw[index] ?? 0);
      return sum + delta * delta;
    }, 0);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  const finalSum = Math.max(1, best.reduce((s, v) => s + v, 0));
  return best.map(u => u / finalSum);
}

function predictRgb(subset: Filament[], weights: number[]): RGB {
  return [0, 1, 2].map(channel => Math.max(0, Math.min(255, Math.round(
    subset.reduce((sum, filament, i) => sum + weights[i] * filament.effectiveRgb[channel], 0),
  )))) as RGB;
}

function hueDegrees(rgb: RGB): number {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h / 6) * 360;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function scoreMixSubset(
  targetRgb: RGB,
  subset: Filament[],
  opts: SuggestionOptions,
  cache?: FilamentSuggestionScoreCache,
): { score: number; rgbError: number; satPenalty: number } | null {
  const cacheKey = cache ? `${paletteScoreKey(targetRgb)}|${opts.ratioStepPercent}|${opts.saturationPenalty}|${subsetScoreKey(subset, cache)}` : '';
  if (cache) {
    const cached = cache.mixScores.get(cacheKey);
    if (cached) return cached;
  }

  const target = targetRgb.map(v => v / 255) as [number, number, number];
  const targetSat = saturation(targetRgb);
  const weights = constrainedMixForSubset(target, subset);
  if (!weights) return null;
  const snapped = snapRatiosToStep(weights, opts.ratioStepPercent);
  const activeSubset: Filament[] = [];
  const activeWeights: number[] = [];
  snapped.forEach((w, i) => {
    if (w > 1e-9) {
      activeSubset.push(subset[i]);
      activeWeights.push(w);
    }
  });
  if (activeSubset.length === 0) return null;
  const predicted = predictRgb(activeSubset, activeWeights);
  const rgbError = Math.sqrt(squaredDistance(targetRgb, predicted));
  let satPenalty = 0;
  for (let i = 0; i < activeSubset.length; i++) {
    const physSat = saturation(activeSubset[i].effectiveRgb);
    const excess = Math.max(0, physSat - targetSat - 0.10);
    satPenalty += activeWeights[i] * excess * excess;
  }
  const satPenalty255 = Math.sqrt(satPenalty) * 255;
  const componentPenalty = Math.max(0, activeSubset.length - 1) * 0.25;
  const result = {
    score: rgbError + opts.saturationPenalty * satPenalty255 + componentPenalty,
    rgbError,
    satPenalty: satPenalty255,
  };
  if (cache) cache.mixScores.set(cacheKey, result);
  return result;
}

function bestMixScoreForColour(
  targetRgb: RGB,
  selected: Filament[],
  opts: SuggestionOptions,
  cache?: FilamentSuggestionScoreCache,
): { score: number; rgbError: number; satPenalty: number } {
  let best: { score: number; rgbError: number; satPenalty: number } | null = null;
  const maxSize = Math.min(opts.maxComponents, selected.length) as 1 | 2 | 3;

  for (let size = 1; size <= maxSize; size++) {
    for (const subset of combinations(selected, size)) {
      const scored = scoreMixSubset(targetRgb, subset, opts, cache);
      if (!scored) continue;
      if (!best || scored.score < best.score) best = scored;
    }
  }

  if (best) return best;
  const nearest = selected.reduce((acc, filament) => {
    const err = Math.sqrt(squaredDistance(targetRgb, filament.effectiveRgb));
    return err < acc ? err : acc;
  }, Number.POSITIVE_INFINITY);
  return { score: nearest, rgbError: nearest, satPenalty: 0 };
}

function suggestionWeights(palette: PaletteEntry[], opts: SuggestionOptions): number[] {
  if (palette.length === 0) return [];
  const exp = Math.max(0, opts.weightExponent);
  const transformed = palette.map(p => exp === 0 ? 1 : Math.pow(Math.max(0, p.count), exp));
  const avg = transformed.reduce((s, w) => s + w, 0) / transformed.length;
  const balance = Math.max(0, Math.min(1, opts.balance));
  return transformed.map(w => Math.max(1e-9, (1 - balance) * w + balance * avg));
}

function physicalDiversityPenalty(selected: Filament[]): number {
  if (selected.length < 2) return 0;
  let pairs = 0;
  let penalty = 0;
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      pairs += 1;
      const a = selected[i].effectiveRgb;
      const b = selected[j].effectiveRgb;
      const dist = Math.sqrt(squaredDistance(a, b)) / 255;
      penalty += 0.50 * Math.max(0, (0.18 - dist) / 0.18) ** 2;

      const satA = saturation(a);
      const satB = saturation(b);
      if (satA > 0.25 && satB > 0.25) {
        const hd = hueDistance(hueDegrees(a), hueDegrees(b));
        const lumD = Math.abs(luminance(a) - luminance(b)) / 255;
        penalty += Math.max(0, (30 - hd) / 30) ** 2
          * Math.min(satA, satB) ** 2
          * Math.max(0, (0.45 - lumD) / 0.45) ** 2;
      }
    }
  }
  return Math.sqrt(penalty / pairs) * 255;
}

function neutralAnchorPenalty(selected: Filament[], palette: PaletteEntry[], weights: number[]): number {
  if (selected.length === 0 || palette.length === 0) return 0;
  const totalWeight = Math.max(1e-9, weights.reduce((s, w) => s + w, 0));
  const neutralWeight = palette.reduce((sum, p, index) => {
    const lum = luminance(p.rgb);
    return sum + (saturation(p.rgb) < 0.28 && lum > 45 && lum < 210 ? weights[index] : 0);
  }, 0);
  const fraction = neutralWeight / totalWeight;
  if (fraction < 0.05) return 0;

  let best = Number.POSITIVE_INFINITY;
  for (const filament of selected) {
    const sat = saturation(filament.effectiveRgb);
    const lum = luminance(filament.effectiveRgb);
    const d = Math.max(0, sat - 0.30) ** 2
      + (Math.max(0, 55 - lum) / 255) ** 2
      + (Math.max(0, lum - 220) / 255) ** 2;
    best = Math.min(best, d);
  }
  return Math.sqrt(best) * 255 * fraction;
}

function evaluateFilamentSet(
  selected: Filament[],
  palette: PaletteEntry[],
  opts: SuggestionOptions,
  cache?: FilamentSuggestionScoreCache,
): number {
  if (selected.length === 0) return Number.POSITIVE_INFINITY;
  const weights = suggestionWeights(palette, opts);
  const totalWeight = Math.max(1e-9, weights.reduce((s, w) => s + w, 0));
  let fitSum = 0;
  for (let i = 0; i < palette.length; i++) {
    const best = bestMixScoreForColour(palette[i].rgb, selected, opts, cache);
    fitSum += weights[i] * best.score * best.score;
  }
  const fitScore = Math.sqrt(fitSum / totalWeight);
  const diversity = physicalDiversityPenalty(selected);
  const neutral = neutralAnchorPenalty(selected, palette, weights);
  return fitScore + opts.diversityPenalty * diversity + opts.neutralWeight * neutral;
}

function dedupeFilaments(filaments: Filament[]): Filament[] {
  const seen = new Set<string>();
  const out: Filament[] = [];
  for (const filament of filaments) {
    const key = `${rgbToHex(filament.effectiveRgb)}|${filament.name}|${filament.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(filament);
  }
  return out;
}

function slotOrderKey(filament: Filament): [number, number, string] {
  return [-luminance(filament.effectiveRgb), hueDegrees(filament.effectiveRgb), filament.name];
}

export function suggestPhysicalSlots(
  palette: PaletteEntry[],
  filaments: Filament[],
  slotCount: number,
  opts: SuggestionOptions,
): PhysicalSlot[] {
  const count = Math.max(3, Math.min(8, slotCount));
  const candidates = dedupeFilaments(filaments);
  if (palette.length === 0 || candidates.length === 0) return [];
  if (candidates.length <= count) return fixedSlotsFromFilaments(candidates, count);

  const filamentKeys = new Map<Filament, string>();
  candidates.forEach((filament, index) => {
    filamentKeys.set(filament, filamentScoreKey(filament, index));
  });
  const suggestionScoreCache: FilamentSuggestionScoreCache = {
    mixScores: new Map(),
    filamentKeys,
  };
  const scoreCache = new Map<string, number>();
  const scoreSet = (set: Filament[]): number => {
    const key = set.map(f => filamentKeys.get(f) || `${f.name}|${rgbToHex(f.effectiveRgb)}|${f.sourceLine}`).sort().join('||');
    const cached = scoreCache.get(key);
    if (cached !== undefined) return cached;
    const score = evaluateFilamentSet(set, palette, opts, suggestionScoreCache);
    scoreCache.set(key, score);
    return score;
  };

  const selected: Filament[] = [];
  const remaining = [...candidates];
  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const score = scoreSet([...selected, remaining[i]]);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    selected.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }

  let improved = true;
  while (improved) {
    improved = false;
    let currentScore = scoreSet(selected);
    let bestSwap: { outIndex: number; inFilament: Filament; score: number } | null = null;
    const notSelected = candidates.filter(candidate => !selected.includes(candidate));
    for (let outIndex = 0; outIndex < selected.length; outIndex++) {
      for (const inFilament of notSelected) {
        const candidateSet = [...selected];
        candidateSet[outIndex] = inFilament;
        const score = scoreSet(candidateSet);
        if (score < currentScore - 1e-9) {
          currentScore = score;
          bestSwap = { outIndex, inFilament, score };
        }
      }
    }
    if (bestSwap) {
      selected[bestSwap.outIndex] = bestSwap.inFilament;
      improved = true;
    }
  }

  const ordered = [...selected].sort((a, b) => {
    const ka = slotOrderKey(a);
    const kb = slotOrderKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });

  return ordered.map((filament, i) => ({
    slot: i + 1,
    filament,
    role: i === 0 ? 'lightest / base' : i === ordered.length - 1 ? 'darkest / shadow' : 'mixing colour',
  }));
}

export function fixedSlotsFromFilaments(filaments: Filament[], count: number): PhysicalSlot[] {
  return filaments.slice(0, count).map((filament, index) => ({
    slot: index + 1,
    filament,
    role: 'fixed physical colour',
  }));
}

export function slotsToCsv(slots: PhysicalSlot[]): string {
  const rows = ['physical_extruder,filament_name,filament_type,colour_rgb,effective_colour_for_mixing,role'];
  for (const s of slots) {
    const esc = (x: string) => `"${x.replaceAll('"', '""')}"`;
    rows.push([`E${s.slot}`, esc(s.filament.name), esc(s.filament.type), rgbToHex(s.filament.rgb), rgbToHex(s.filament.effectiveRgb), esc(s.role)].join(','));
  }
  return rows.join('\n') + '\n';
}
