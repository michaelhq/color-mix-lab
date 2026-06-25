import type { AccentProtectionMode, PaletteEntry, RGB } from "./types";
import { luminance, squaredDistance, clamp255 } from "./colour";

interface WeightedColour {
  rgb: RGB;
  /** Number of source triangles/faces represented by this colour bucket. */
  count: number;
  /** Area-normalised source weight. A large triangle therefore counts more than a tiny one. */
  weight: number;
  /** Compressed palette-building weight used to preserve accents instead of only dominant colours. */
  importance: number;
}

function colourKey(rgb: RGB): number {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

function rgbFromKey(key: number): RGB {
  return [(key >> 16) & 255, (key >> 8) & 255, key & 255];
}

function bucketKey(rgb: RGB, bits: number): number {
  const shift = 8 - bits;
  return (
    ((rgb[0] >> shift) << (bits * 2)) |
    ((rgb[1] >> shift) << bits) |
    (rgb[2] >> shift)
  );
}

function bucketCenterFromKey(key: number, bits: number): RGB {
  const mask = (1 << bits) - 1;
  const b = key & mask;
  const g = (key >> bits) & mask;
  const r = (key >> (bits * 2)) & mask;
  const scale = 255 / mask;
  return [clamp255(r * scale), clamp255(g * scale), clamp255(b * scale)];
}

function max3(rgb: RGB): number {
  return Math.max(rgb[0], rgb[1], rgb[2]);
}

function chroma(rgb: RGB): number {
  return (
    (Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2])) / 255
  );
}

function hueDegrees(rgb: RGB): number | null {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 1e-6) return null;
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return hue;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function isRedAccentHue(hue: number): boolean {
  // Includes dark red, brick red, vermilion and red-orange. These tones are
  // easily swallowed by brown earth colours in RGB matching although the user
  // perceives them as red accents, for example lips or painted ornaments.
  return hue >= 345 || hue <= 34;
}

function isWarmBrownHue(hue: number): boolean {
  return hue > 20 && hue <= 62;
}

function normalizedSourceWeights(
  sourceWeights: number[] | undefined,
  length: number,
): number[] | null {
  if (!sourceWeights || sourceWeights.length !== length) return null;
  let sum = 0;
  let valid = 0;
  for (const value of sourceWeights) {
    if (Number.isFinite(value) && value > 0) {
      sum += value;
      valid += 1;
    }
  }
  if (valid === 0 || sum <= 0) return null;

  const average = sum / valid;
  return sourceWeights.map((value) =>
    Number.isFinite(value) && value > 0
      ? Math.max(0.05, Math.min(50, value / average))
      : 1,
  );
}

function finaliseImportance(
  counter: Map<number, WeightedColour>,
  accentProtection: AccentProtectionMode = "balanced",
): Map<number, WeightedColour> {
  for (const item of counter.values()) {
    // The palette must not be a pure histogram.  Baked scans often contain large
    // regions with thousands of nearly identical brown/orange tones and much
    // smaller, but semantically relevant, accent surfaces.  The compressed area
    // exponent keeps large regions relevant without letting them consume all
    // virtual colours.
    const area = Math.max(0.0001, item.weight);
    const c = chroma(item.rgb);
    const accentBoost =
      accentProtection === "off"
        ? 1
        : 1 + c * (accentProtection === "strong" ? 1.25 : 0.85);
    const areaExponent =
      accentProtection === "strong"
        ? 0.39
        : accentProtection === "off"
          ? 0.52
          : 0.44;
    item.importance = Math.pow(area, areaExponent) * accentBoost;
  }
  return counter;
}

class ColorBox {
  items: WeightedColour[];
  count: number;
  weight: number;
  importance: number;
  min: RGB;
  max: RGB;
  ranges: RGB;

  constructor(items: WeightedColour[]) {
    this.items = items;

    let count = 0;
    let weight = 0;
    let importance = 0;
    let minR = 255;
    let minG = 255;
    let minB = 255;
    let maxR = 0;
    let maxG = 0;
    let maxB = 0;

    for (const item of items) {
      const rgb = item.rgb;
      count += item.count;
      weight += item.weight;
      importance += item.importance;
      if (rgb[0] < minR) minR = rgb[0];
      if (rgb[1] < minG) minG = rgb[1];
      if (rgb[2] < minB) minB = rgb[2];
      if (rgb[0] > maxR) maxR = rgb[0];
      if (rgb[1] > maxG) maxG = rgb[1];
      if (rgb[2] > maxB) maxB = rgb[2];
    }

    this.count = count;
    this.weight = weight;
    this.importance = importance;
    this.min = [minR, minG, minB];
    this.max = [maxR, maxG, maxB];
    this.ranges = [maxR - minR, maxG - minG, maxB - minB];
  }

  splittable(): boolean {
    return this.items.length > 1 && max3(this.ranges) > 0;
  }

  score(): number {
    const rangeScore =
      max3(this.ranges) * 1.6 +
      this.ranges[0] +
      this.ranges[1] +
      this.ranges[2];
    return rangeScore * (1 + Math.log2(Math.max(1, this.importance)) * 0.18);
  }

  average(): RGB {
    const denominator = this.weight > 0 ? this.weight : this.count;
    if (denominator <= 0) return [0, 0, 0];
    let r = 0;
    let g = 0;
    let b = 0;
    for (const item of this.items) {
      const w = this.weight > 0 ? item.weight : item.count;
      r += item.rgb[0] * w;
      g += item.rgb[1] * w;
      b += item.rgb[2] * w;
    }
    return [
      clamp255(r / denominator),
      clamp255(g / denominator),
      clamp255(b / denominator),
    ];
  }

  split(): [ColorBox, ColorBox] {
    let channel = 0;
    if (this.ranges[1] > this.ranges[channel]) channel = 1;
    if (this.ranges[2] > this.ranges[channel]) channel = 2;

    const items = this.items.slice();
    items.sort((a, b) => a.rgb[channel] - b.rgb[channel]);

    const half = this.importance / 2;
    let running = 0;
    let splitAt = 1;
    for (let i = 0; i < items.length; i++) {
      running += items[i].importance;
      if (running >= half) {
        splitAt = Math.max(1, Math.min(items.length - 1, i + 1));
        break;
      }
    }

    return [
      new ColorBox(items.slice(0, splitAt)),
      new ColorBox(items.slice(splitAt)),
    ];
  }
}

export function buildColourCounter(
  colours: RGB[],
  sourceWeights?: number[],
  accentProtection: AccentProtectionMode = "balanced",
): Map<number, WeightedColour> {
  const weights = normalizedSourceWeights(sourceWeights, colours.length);
  const counter = new Map<number, WeightedColour>();
  for (let i = 0; i < colours.length; i++) {
    const rgb = colours[i];
    const key = colourKey(rgb);
    const w = weights ? weights[i] : 1;
    const prev = counter.get(key);
    if (prev) {
      prev.count += 1;
      prev.weight += w;
    } else {
      counter.set(key, {
        rgb: rgbFromKey(key),
        count: 1,
        weight: w,
        importance: 0,
      });
    }
  }
  return finaliseImportance(counter, accentProtection);
}

function buildBucketedColourCounter(
  colours: RGB[],
  bits: number,
  sourceWeights?: number[],
  accentProtection: AccentProtectionMode = "balanced",
): Map<number, WeightedColour> {
  const weights = normalizedSourceWeights(sourceWeights, colours.length);
  const counter = new Map<number, WeightedColour>();
  for (let i = 0; i < colours.length; i++) {
    const rgb = colours[i];
    const key = bucketKey(rgb, bits);
    const w = weights ? weights[i] : 1;
    const prev = counter.get(key);
    if (prev) {
      prev.count += 1;
      prev.weight += w;
    } else {
      counter.set(key, {
        rgb: bucketCenterFromKey(key, bits),
        count: 1,
        weight: w,
        importance: 0,
      });
    }
  }
  return finaliseImportance(counter, accentProtection);
}

function counterForPalette(
  colours: RGB[],
  sourceWeights?: number[],
  accentProtection: AccentProtectionMode = "balanced",
): Map<number, WeightedColour> {
  // Exact 24-bit colour counting can create hundreds of thousands or millions
  // of unique entries for baked photographic textures. For large inputs we
  // aggregate colours before palette construction. Five bits still preserves
  // the hue families that matter for accent retention, including muted greens.
  if (colours.length >= 1_500_000)
    return buildBucketedColourCounter(
      colours,
      5,
      sourceWeights,
      accentProtection,
    );
  if (colours.length >= 250_000)
    return buildBucketedColourCounter(
      colours,
      5,
      sourceWeights,
      accentProtection,
    );
  if (colours.length >= 100_000)
    return buildBucketedColourCounter(
      colours,
      6,
      sourceWeights,
      accentProtection,
    );
  return buildColourCounter(colours, sourceWeights, accentProtection);
}

function medianCutFromItems(
  items: WeightedColour[],
  maxColours: number,
): PaletteEntry[] {
  if (items.length === 0) return [];
  const targetColours = Math.max(1, Math.min(maxColours, items.length));
  let boxes = [new ColorBox(items)];

  while (boxes.length < targetColours) {
    let best = -1;
    let bestScore = -1;

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (!box.splittable()) continue;
      const score = box.score();
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }

    if (best < 0) break;
    const [left, right] = boxes[best].split();
    const nextBoxes = boxes.slice(0, best);
    nextBoxes.push(left, right, ...boxes.slice(best + 1));
    boxes = nextBoxes;
  }

  return boxes.map((box) => ({
    rgb: box.average(),
    count: box.count,
    index: 0,
  }));
}


function nearestAccentAwareCenterIndex(
  rgb: RGB,
  centers: RGB[],
  accentProtection: AccentProtectionMode = "balanced",
): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centers.length; i++) {
    const d = paletteMatchDistance(rgb, centers[i], accentProtection);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function buildDiversePalette(
  items: WeightedColour[],
  maxColours: number,
  accentProtection: AccentProtectionMode = "balanced",
): PaletteEntry[] {
  if (items.length === 0) return [];
  const targetColours = Math.max(1, Math.min(maxColours, items.length));
  if (items.length <= targetColours) {
    return items.map((item) => ({
      rgb: item.rgb,
      count: item.count,
      index: 0,
    }));
  }

  // Seed virtual colours with weighted farthest-point sampling.  This makes the
  // reduction explicitly prefer colour-space coverage over pure area frequency,
  // so small but separated hue accents do not disappear behind dominant browns.
  const centers: RGB[] = [];
  const minDistances = new Float64Array(items.length);
  minDistances.fill(Number.POSITIVE_INFINITY);

  let firstIndex = 0;
  let firstScore = -1;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const score = item.importance * (1 + chroma(item.rgb) * 0.35);
    if (score > firstScore) {
      firstScore = score;
      firstIndex = i;
    }
  }
  centers.push(items[firstIndex].rgb);

  while (centers.length < targetColours) {
    const latest = centers[centers.length - 1];
    let bestIndex = -1;
    let bestScore = -1;

    for (let i = 0; i < items.length; i++) {
      const d = squaredDistance(items[i].rgb, latest);
      if (d < minDistances[i]) minDistances[i] = d;
      if (minDistances[i] <= 1) continue;

      const item = items[i];
      const hue = hueDegrees(item.rgb);
      let hueNovelty = 1;
      if (hue !== null) {
        let minHueDistance = 180;
        for (const center of centers) {
          const centerHue = hueDegrees(center);
          if (centerHue !== null)
            minHueDistance = Math.min(
              minHueDistance,
              hueDistance(hue, centerHue),
            );
        }
        hueNovelty += Math.min(0.85, minHueDistance / 105);
      }

      const c = chroma(item.rgb);
      const chromaBoost =
        accentProtection === "off"
          ? 1
          : 1 + c * (accentProtection === "strong" ? 1.2 : 0.85);
      const score =
        Math.pow(minDistances[i], 0.72) *
        Math.pow(
          Math.max(0.0001, item.importance),
          accentProtection === "strong" ? 0.28 : 0.34,
        ) *
        chromaBoost *
        hueNovelty;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) break;
    centers.push(items[bestIndex].rgb);
  }

  const clusterCount = centers.length;
  const sums = Array.from({ length: clusterCount }, () => ({
    r: 0,
    g: 0,
    b: 0,
    weight: 0,
    count: 0,
  }));

  for (const item of items) {
    const index = nearestAccentAwareCenterIndex(
      item.rgb,
      centers,
      accentProtection,
    );
    const target = sums[index];
    const w = item.weight > 0 ? item.weight : item.count;
    target.r += item.rgb[0] * w;
    target.g += item.rgb[1] * w;
    target.b += item.rgb[2] * w;
    target.weight += w;
    target.count += item.count;
  }

  const palette: PaletteEntry[] = [];
  for (const sum of sums) {
    if (sum.weight <= 0 || sum.count <= 0) continue;
    palette.push({
      rgb: [
        clamp255(sum.r / sum.weight),
        clamp255(sum.g / sum.weight),
        clamp255(sum.b / sum.weight),
      ],
      count: sum.count,
      index: 0,
    });
  }

  return palette;
}

interface HueAccentCandidate {
  rgb: RGB;
  count: number;
  weight: number;
  score: number;
  hue: number;
  chroma: number;
}

function protectedHueAccentCandidates(
  items: WeightedColour[],
  maxColours: number,
  accentProtection: AccentProtectionMode = "balanced",
): HueAccentCandidate[] {
  if (accentProtection === "off" || maxColours < 12 || items.length === 0)
    return [];
  const strong = accentProtection === "strong";

  // Accents are not necessarily highly saturated. The Nefertiti hat band, for
  // example, contains muted olive/green details that are easy to average into
  // grey/brown if the palette is driven only by area. Therefore candidates are
  // built per hue and chroma/luminance cell and represented by an actual source
  // colour, not by the weighted average of the whole hue bin.
  const hueBins = 36;
  const cells = new Map<
    string,
    {
      r: number;
      g: number;
      b: number;
      weight: number;
      count: number;
      importance: number;
      maxChroma: number;
      representative: WeightedColour | null;
      representativeScore: number;
      hue: number;
    }
  >();
  let totalImportance = 0;
  let totalWeight = 0;

  for (const item of items) {
    totalImportance += item.importance;
    totalWeight += item.weight;
    const h = hueDegrees(item.rgb);
    const c = chroma(item.rgb);
    if (h === null || c < (strong ? 0.042 : 0.055)) continue;
    const lum = luminance(item.rgb);
    const hueIndex = Math.max(
      0,
      Math.min(hueBins - 1, Math.floor((h / 360) * hueBins)),
    );
    const chromaIndex = c < 0.12 ? 0 : c < 0.26 ? 1 : 2;
    const luminanceIndex = lum < 88 ? 0 : lum < 176 ? 1 : 2;
    const key = `${hueIndex}:${chromaIndex}:${luminanceIndex}`;
    const cell = cells.get(key) ?? {
      r: 0,
      g: 0,
      b: 0,
      weight: 0,
      count: 0,
      importance: 0,
      maxChroma: 0,
      representative: null,
      representativeScore: -1,
      hue: (hueIndex + 0.5) * (360 / hueBins),
    };
    const w = item.weight > 0 ? item.weight : item.count;
    cell.r += item.rgb[0] * w;
    cell.g += item.rgb[1] * w;
    cell.b += item.rgb[2] * w;
    cell.weight += w;
    cell.count += item.count;
    cell.importance += item.importance;
    cell.maxChroma = Math.max(cell.maxChroma, c);

    // Prefer a real, visible representative of the hue cell. This avoids turning
    // a small olive/green patch into a grey average before it can be protected.
    const representativeScore =
      Math.pow(Math.max(0.0001, item.importance), 0.62) * (0.55 + c * 1.75);
    if (representativeScore > cell.representativeScore) {
      cell.representative = item;
      cell.representativeScore = representativeScore;
    }
    cells.set(key, cell);
  }

  if (totalImportance <= 0 || totalWeight <= 0) return [];
  const minImportanceShare = Math.max(
    strong ? 0.00006 : 0.00012,
    (strong ? 0.0024 : 0.0045) / Math.sqrt(maxColours),
  );
  const minWeightShare = Math.max(
    strong ? 0.00004 : 0.00008,
    (strong ? 0.0014 : 0.0028) / Math.sqrt(maxColours),
  );
  const candidates: HueAccentCandidate[] = [];

  for (const cell of cells.values()) {
    if (cell.weight <= 0 || !cell.representative) continue;
    const importanceShare = cell.importance / totalImportance;
    const weightShare = cell.weight / totalWeight;
    if (
      importanceShare < minImportanceShare &&
      weightShare < minWeightShare &&
      cell.maxChroma < (strong ? 0.1 : 0.16)
    )
      continue;
    const representative = cell.representative;
    const representativeChroma = chroma(representative.rgb);
    const avgRgb: RGB = [
      clamp255(cell.r / cell.weight),
      clamp255(cell.g / cell.weight),
      clamp255(cell.b / cell.weight),
    ];
    const avgChroma = chroma(avgRgb);
    const rgb =
      representativeChroma >= Math.max(0.075, avgChroma * 1.18)
        ? representative.rgb
        : avgRgb;
    candidates.push({
      rgb,
      count: cell.count,
      weight: cell.weight,
      score:
        Math.sqrt(Math.max(importanceShare, weightShare)) *
        (0.55 +
          Math.max(avgChroma, representativeChroma) * (strong ? 1.75 : 1.3)),
      hue: hueDegrees(rgb) ?? cell.hue,
      chroma: chroma(rgb),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected: HueAccentCandidate[] = [];
  const limit = Math.max(
    strong ? 6 : 4,
    Math.min(strong ? 36 : 24, Math.round(maxColours * (strong ? 0.46 : 0.34))),
  );
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const tooClose = selected.some((item) => {
      const hd = hueDistance(item.hue, candidate.hue);
      const rgbDistance = squaredDistance(item.rgb, candidate.rgb);
      return (
        hd < (strong ? 7 : 10) &&
        Math.abs(item.chroma - candidate.chroma) < (strong ? 0.045 : 0.06) &&
        rgbDistance < (strong ? 360 : 520)
      );
    });
    if (!tooClose) selected.push(candidate);
  }
  return selected;
}

function paletteRedundancyIndex(
  palette: PaletteEntry[],
  protectedIndices: Set<number>,
): number {
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    if (protectedIndices.has(i)) continue;
    let nearest = Number.POSITIVE_INFINITY;
    for (let j = 0; j < palette.length; j++) {
      if (i === j) continue;
      nearest = Math.min(
        nearest,
        squaredDistance(palette[i].rgb, palette[j].rgb),
      );
    }
    const score = nearest * Math.log2(Math.max(2, palette[i].count + 1));
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function injectProtectedAccents(
  palette: PaletteEntry[],
  items: WeightedColour[],
  maxColours: number,
  accentProtection: AccentProtectionMode = "balanced",
): PaletteEntry[] {
  if (accentProtection === "off" || palette.length === 0) return palette;
  const next = palette.map((entry) => ({ ...entry }));
  const protectedIndices = new Set<number>();
  const candidates = protectedHueAccentCandidates(
    items,
    maxColours,
    accentProtection,
  );

  for (const candidate of candidates) {
    const nearest = nearestAccentAwareCenterIndex(
      candidate.rgb,
      next.map((entry) => entry.rgb),
      accentProtection,
    );
    const nearestDistance = squaredDistance(candidate.rgb, next[nearest].rgb);
    const candidateHue = hueDegrees(candidate.rgb);
    const nearestHue = hueDegrees(next[nearest].rgb);
    const nearestChroma = chroma(next[nearest].rgb);
    const sameAccentFamily =
      candidateHue !== null &&
      nearestHue !== null &&
      hueDistance(candidateHue, nearestHue) <=
        (accentProtection === "strong" ? 8 : 12) &&
      nearestChroma >=
        candidate.chroma * (accentProtection === "strong" ? 0.7 : 0.58);
    // If the palette already has a real representative for this hue/chroma
    // family, do not force another one. A merely RGB-near grey/brown tone does
    // not count as a representative for a muted green/cyan/red accent.
    if (
      nearestDistance < (accentProtection === "strong" ? 230 : 360) &&
      sameAccentFamily
    ) {
      protectedIndices.add(nearest);
      continue;
    }
    const replaceIndex = paletteRedundancyIndex(next, protectedIndices);
    if (replaceIndex < 0) break;
    next[replaceIndex] = {
      rgb: candidate.rgb,
      count: candidate.count,
      index: 0,
    };
    protectedIndices.add(replaceIndex);
  }

  return next;
}

function finalisePaletteIndices(palette: PaletteEntry[]): PaletteEntry[] {
  const sorted = palette.slice();
  sorted.sort(
    (a, b) => luminance(b.rgb) - luminance(a.rgb) || b.rgb[0] - a.rgb[0],
  );
  return sorted.map((p, i) => ({ index: i + 1, rgb: p.rgb, count: p.count }));
}

export function medianCutPalette(
  colours: RGB[],
  maxColours: number,
  sourceWeights?: number[],
  accentProtection: AccentProtectionMode = "balanced",
): PaletteEntry[] {
  const counter = counterForPalette(colours, sourceWeights, accentProtection);
  const items: WeightedColour[] = Array.from(counter.values());
  if (items.length === 0) return [];

  const targetColours = Math.max(1, Math.min(maxColours, items.length));
  const palette =
    accentProtection !== "off" && targetColours >= 24
      ? buildDiversePalette(items, targetColours, accentProtection)
      : medianCutFromItems(items, targetColours);
  const accentAwarePalette = injectProtectedAccents(
    palette,
    items,
    targetColours,
    accentProtection,
  );
  return finalisePaletteIndices(accentAwarePalette);
}

function paletteMatchDistance(
  source: RGB,
  candidate: RGB,
  accentProtection: AccentProtectionMode = "balanced",
): number {
  const base = squaredDistance(source, candidate);
  if (accentProtection === "off") return base;
  const strong = accentProtection === "strong";
  const sourceHue = hueDegrees(source);
  const candidateHue = hueDegrees(candidate);
  const sourceChroma = chroma(source);
  const candidateChroma = chroma(candidate);
  const maxChroma = Math.max(sourceChroma, candidateChroma);
  const sourceLum = luminance(source);
  const candidateLum = luminance(candidate);

  // RGB distance alone can map a small but meaningful hue accent to a larger
  // neighbouring colour family, especially after palette reduction. Hue family
  // should stay stable for any chromatic accent, not only for red details.
  let huePenalty = 0;
  let accentPenalty = 0;
  let hueReward = 0;

  const sourceIsChromaticAccent = sourceHue !== null && sourceChroma >= 0.09;
  if (sourceIsChromaticAccent) {
    const candidateTooNeutral =
      candidateHue === null || candidateChroma < sourceChroma * 0.52;
    if (candidateTooNeutral) {
      accentPenalty +=
        (strong ? 2_250 : 1_350) +
        Math.pow((sourceChroma - candidateChroma) * (strong ? 245 : 185), 2);
    }
  }

  if (sourceHue !== null && candidateHue !== null && maxChroma > 0.055) {
    const hd = hueDistance(sourceHue, candidateHue);
    huePenalty =
      Math.pow(hd * (strong ? 3.15 : 2.45), 2) *
      (0.36 + maxChroma * (strong ? 1.22 : 0.96));

    if (sourceIsChromaticAccent) {
      const candidateSameHueFamily =
        hd <= 20 && candidateChroma >= sourceChroma * 0.48;
      const candidateTooNeutral = candidateChroma < sourceChroma * 0.52;
      const candidateDifferentHue = hd > 22;
      if (!candidateSameHueFamily && candidateDifferentHue) {
        accentPenalty +=
          (strong ? 2_350 : 1_450) +
          Math.min(
            strong ? 6_400 : 3_600,
            Math.pow(hd - 22, 2) * (strong ? 5.1 : 3.1),
          );
      }
      if (candidateTooNeutral) accentPenalty += strong ? 1_850 : 1_050;
      if (candidateSameHueFamily) hueReward = Math.min(base * 0.24, 620);
    }

    // Red accents need an additional safeguard because RGB distance can rank
    // muted warm browns too close to small saturated red details.
    const sourceIsRedAccent =
      isRedAccentHue(sourceHue) &&
      sourceChroma >= 0.2 &&
      source[0] > source[1] + 18;
    if (sourceIsRedAccent) {
      const candidateIsRedAccent =
        isRedAccentHue(candidateHue) && candidateChroma >= sourceChroma * 0.62;
      const candidateLooksBrown =
        isWarmBrownHue(candidateHue) && candidateChroma < sourceChroma * 0.82;
      if (!candidateIsRedAccent) accentPenalty += 1_650;
      if (candidateLooksBrown) accentPenalty += 2_400;
      if (candidateIsRedAccent && hd <= 16)
        hueReward = Math.max(hueReward, Math.min(base * 0.28, 720));
    }
  }

  const chromaPenalty = Math.pow(
    (sourceChroma - candidateChroma) * (strong ? 245 : 190),
    2,
  );
  const luminancePenalty = Math.pow(
    (sourceLum - candidateLum) * (strong ? 0.32 : 0.38),
    2,
  );
  return (
    base +
    huePenalty +
    accentPenalty +
    chromaPenalty +
    luminancePenalty -
    hueReward
  );
}

export function nearestPaletteIndex(
  rgb: RGB,
  palette: PaletteEntry[],
  accentProtection: AccentProtectionMode = "balanced",
): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const d = paletteMatchDistance(rgb, palette[i].rgb, accentProtection);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
