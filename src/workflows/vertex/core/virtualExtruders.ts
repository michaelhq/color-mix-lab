import type {
  AccentProtectionMode,
  ColourDifferenceMetric,
  PaletteEntry,
  PhysicalSlot,
  RGB,
  VirtualMixPriorityMode,
  MappingStrategyMode,
  MixingRecipeResolution,
} from "./types";
import { clamp255, rgbToHex, squaredDistance } from "./colour";
import {
  colourDistance,
  hueDistanceDegrees,
  labChroma,
  labHueDegrees,
  labToRgb,
  mixFilamentsRgb,
  rgbToLab,
  type LAB,
} from "./prusaFdmMixer";

export interface VirtualBlendComponent {
  extruder: number;
  ratio: number;
  count: number;
  rgb: RGB;
}

export interface VirtualBlendEntry {
  virtualId: number;
  // Colour used for the virtual-extruder palette and print preview.
  // It is predicted with the Prusa FDM mixer model, not with a simple RGB layer average.
  displayRgb: RGB;
  // Diagnostic colour: simple RGB average of the physical layer sequence.
  // It is useful for CSV comparison, but it is not used as the print preview colour.
  layerAverageRgb: RGB;
  components: VirtualBlendComponent[];
  sequence: number[];
  sequenceKey: string;
  targetPaletteIndices: number[];
  triangleCount: number;
  linearRgbError: number;
}

export interface PhysicalOnlyEntry {
  // First palette index in the merged physical assignment, used as stable UI key.
  paletteIndex: number;
  targetPaletteIndices: number[];
  targetRgb: RGB;
  physicalRgb: RGB;
  physicalExtruder: number;
  triangleCount: number;
  linearRgbError: number;
}

export interface VirtualMappingDiagnostics {
  targetPaletteCount: number;
  averageError: number;
  worstError: number;
  poorMatchCount: number;
  poorMatchThreshold: number;
  collapsedTargetColours: number;
}

export interface VirtualExtruderPlan {
  virtualBlends: VirtualBlendEntry[];
  physicalOnly: PhysicalOnlyEntry[];
  mappingDiagnostics: VirtualMappingDiagnostics;
  paletteToAssignment: Map<
    number,
    | { kind: "physical"; extruder: number }
    | { kind: "virtual"; virtualId: number }
  >;
}

export interface VirtualExtruderPlanOptions {
  maxComponents: 1 | 2 | 3;
  virtualStartId: number;
  purePhysicalThreshold: number;
  ratioStepPercent?: number;
  recipeResolution?: MixingRecipeResolution;
  accentProtection: AccentProtectionMode;
  mixPriority: VirtualMixPriorityMode;
  mappingStrategy: MappingStrategyMode;
  colourDifferenceMetric: ColourDifferenceMetric;
  /**
   * LAB L* offset for the preview colour model. The exported layer sequence is
   * kept independent from display calibration so slicer output remains stable.
   */
  previewLightnessOffset: number;
}

// Virtual mixtures are generated as discrete layer-sequence recipes. The UI
// exposes a recipe resolution, but PrusaSlicer-compatible recipes use 5%
// percentage steps. The only non-5% special case is the equal three-colour
// 1:1:1 recipe, displayed as 33/33/33 while the printable sequence keeps the
// exact integer counts.
const BLEND_PERCENT_UNIT = 5;
const BLEND_TOTAL_UNITS = Math.round(100 / BLEND_PERCENT_UNIT);
const BLEND_WEIGHT_RESOLUTION = 64;
const BLEND_QUANTISE_MAX_ERROR = 0.03;
const POOR_MAPPING_DELTA_E76 = 18;
const POOR_MAPPING_DELTA_E2000 = 8;

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

function gcdAll(values: number[]): number {
  return values.reduce((acc, v) => gcd(acc, v), values[0] || 1);
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





export function quantiseComponentCounts(ratios: number[]): number[] {
  const active = ratios.filter((r) => r > 0);
  if (active.length === 0) return [];
  if (active.length === 1) return [1];

  const totalRatio = active.reduce((s, r) => s + r, 0);
  let counts: number[] = [];
  for (
    let cycleCandidate = 2;
    cycleCandidate <= BLEND_WEIGHT_RESOLUTION;
    cycleCandidate++
  ) {
    counts = active.map((r) =>
      Math.max(1, Math.round((r / totalRatio) * cycleCandidate)),
    );
    const sumCounts = counts.reduce((s, c) => s + c, 0);
    let maxRatioError = 0;
    for (let i = 0; i < active.length; i++) {
      const targetRatio = active[i] / totalRatio;
      const actualRatio = counts[i] / sumCounts;
      maxRatioError = Math.max(
        maxRatioError,
        Math.abs(targetRatio - actualRatio),
      );
    }
    if (maxRatioError <= BLEND_QUANTISE_MAX_ERROR) break;
  }

  const g = gcdAll(counts);
  return g > 1 ? counts.map((c) => c / g) : counts;
}

export function buildCanonicalCycle(
  components: Array<{ extruder: number; ratio: number; count?: number }>,
): { sequence: number[]; counts: number[] } {
  const active = components
    .filter((component) => component.ratio > 0 || (component.count ?? 0) > 0)
    .sort((a, b) => a.extruder - b.extruder);
  if (active.length === 0) return { sequence: [], counts: [] };
  if (active.length === 1)
    return { sequence: [active[0].extruder], counts: [1] };

  // If the caller already snapped the mixture to a UI/printing step such as 5%
  // or 2.5%, keep those exact integer units. Re-running Prusa-like ratio
  // quantisation here may otherwise turn 5/75/20 into 6.7/73.3/20 because the
  // sequence optimiser accepts an error tolerance. That is useful for free-form
  // sliders, but wrong for our generated virtual colours because the UI and
  // PrusaSlicer presets only offer coarse percentage steps.
  const providedCounts = active.map((component) =>
    Math.round(component.count ?? 0),
  );
  const hasProvidedCounts =
    providedCounts.length === active.length &&
    providedCounts.every((count) => count > 0);
  let counts = hasProvidedCounts
    ? providedCounts
    : quantiseComponentCounts(active.map((component) => component.ratio));

  // Shorten the cycle if possible, but preserve exact percentages.
  const g = gcdAll(counts);
  if (g > 1) counts = counts.map((count) => count / g);

  const cycleLength = counts.reduce((s, c) => s + c, 0);
  const emitted = counts.map(() => 0);
  const sequence: number[] = [];

  for (let slotIndex = 0; slotIndex < cycleLength; slotIndex++) {
    let bestIndex = 0;
    let bestDeficit = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < counts.length; i++) {
      const idealCountAtThisSlot = ((slotIndex + 1) * counts[i]) / cycleLength;
      const deficit = idealCountAtThisSlot - emitted[i];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestIndex = i;
      }
    }
    emitted[bestIndex] += 1;
    sequence.push(active[bestIndex].extruder);
  }

  return { sequence, counts };
}

interface SnappedActiveRatio {
  slot: PhysicalSlot;
  ratio: number;
  unitCount: number;
}



function rgbError(a: RGB, b: RGB): number {
  return Math.sqrt(squaredDistance(a, b));
}

function effectiveRgbFromCounts(
  active: SnappedActiveRatio[],
  counts: number[],
): RGB {
  const total = Math.max(
    1,
    counts.reduce((sum, count) => sum + count, 0),
  );
  return [0, 1, 2].map((channel) =>
    clamp255(
      active.reduce(
        (sum, item, index) =>
          sum + (counts[index] ?? 0) * item.slot.filament.effectiveRgb[channel],
        0,
      ) / total,
    ),
  ) as RGB;
}

function isWarmBrownOrangeRustTarget(lab: LAB): boolean {
  const chroma = labChroma(lab);
  const hue = labHueDegrees(lab);
  return chroma >= 8 && lab.a >= 3 && lab.b >= 6 && hue >= 22 && hue <= 82;
}

function isGreenOliveCandidate(lab: LAB): boolean {
  const chroma = labChroma(lab);
  const hue = labHueDegrees(lab);
  return chroma >= 5 && lab.b > -4 && (lab.a < 1 || (hue >= 76 && hue <= 150));
}

function warmNeutralGuardPenalty(
  targetLab: LAB,
  candidateLab: LAB,
  hueGap: number,
): number {
  const targetChroma = labChroma(targetLab);
  const candidateChroma = labChroma(candidateLab);
  const lightnessGap = Math.abs(candidateLab.L - targetLab.L);
  let penalty = 0;

  if (isWarmBrownOrangeRustTarget(targetLab)) {
    const redGreenDrift = Math.max(0, targetLab.a - candidateLab.a);
    const candidateIsOlive = isGreenOliveCandidate(candidateLab);
    if (candidateIsOlive) penalty += 4.5;
    if (redGreenDrift > 6) penalty += (redGreenDrift - 6) * 0.55;
    if (hueGap > 18) penalty += (hueGap - 18) * 0.26;
    if (candidateChroma < targetChroma * 0.45)
      penalty += (targetChroma * 0.45 - candidateChroma) * 0.14;
  }

  if (targetChroma <= 16) {
    const chromaOvershoot = Math.max(0, candidateChroma - (targetChroma + 7));
    const chromaGap = Math.abs(candidateChroma - targetChroma);
    if (lightnessGap > 7) penalty += (lightnessGap - 7) * 0.42;
    if (chromaOvershoot > 0) penalty += chromaOvershoot * 0.30;
    if (chromaGap > 12) penalty += (chromaGap - 12) * 0.14;
    if (Math.abs(candidateLab.a) > Math.abs(targetLab.a) + 9)
      penalty += (Math.abs(candidateLab.a) - Math.abs(targetLab.a) - 9) * 0.20;
    if (Math.abs(candidateLab.b) > Math.abs(targetLab.b) + 11)
      penalty += (Math.abs(candidateLab.b) - Math.abs(targetLab.b) - 11) * 0.16;
  }

  return penalty;
}

interface BlendCandidate {
  subset: PhysicalSlot[];
  ratios: number[];
  unitCounts: number[];
  active: SnappedActiveRatio[];
  sequence: number[];
  sequenceKey: string;
  fdmRgb: RGB;
  fdmLab: LAB;
  fdmChroma: number;
  fdmHue: number;
  rgbChroma: number;
  complexityPenalty: number;
  layerAverageRgb: RGB;
}

const blendCandidateCache = new WeakMap<
  PhysicalSlot[],
  Map<string, BlendCandidate[]>
>();

function recipeResolutionFromLegacyStep(ratioStepPercent: number | undefined): MixingRecipeResolution {
  const safeStep = Number.isFinite(ratioStepPercent) ? Number(ratioStepPercent) : 5;
  if (safeStep === 10) return "grid10";
  if (safeStep === 20) return "grid20";
  if (safeStep === 25) return "grid25";
  if (safeStep === 50) return "half-thirds";
  return "grid5";
}

function stepUnitsForRecipeResolution(recipeResolution: MixingRecipeResolution): number | null {
  switch (recipeResolution) {
    case "grid10":
      return 2;
    case "grid20":
      return 4;
    case "grid25":
      return 5;
    case "grid5":
      return 1;
    case "thirds":
    case "half-thirds":
      return null;
  }
}

function reducedCountKey(counts: number[]): string {
  const g = gcdAll(counts);
  return counts.map((count) => Math.round(count / g)).join(":");
}

function buildUnitCountCompositions(
  parts: number,
  totalUnits: number,
  recipeResolution: MixingRecipeResolution,
): number[][] {
  if (parts <= 1) return [[1]];

  const out: number[][] = [];
  const seen = new Set<string>();
  const addCounts = (counts: number[]) => {
    if (counts.length !== parts || counts.some((count) => count <= 0)) return;
    const key = reducedCountKey(counts);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(counts);
  };

  if (recipeResolution === "thirds") {
    if (parts === 2) {
      addCounts([1, 2]);
      addCounts([2, 1]);
    } else if (parts === 3) {
      addCounts([1, 1, 1]);
    }
    return out;
  }

  if (recipeResolution === "half-thirds") {
    if (parts === 2) addCounts([1, 1]);
    else if (parts === 3) addCounts([1, 1, 1]);
    return out;
  }

  const stepUnits = stepUnitsForRecipeResolution(recipeResolution) ?? 1;
  const minUnits = Math.max(1, stepUnits);
  const allowedOffGridComponents = totalUnits % stepUnits === 0 ? 0 : 1;

  const rec = (
    remainingParts: number,
    remainingUnits: number,
    current: number[],
  ) => {
    if (remainingParts === 1) {
      if (remainingUnits < minUnits) return;
      const counts = [...current, remainingUnits];
      const offGrid = counts.filter((count) => count % stepUnits !== 0).length;
      if (offGrid <= allowedOffGridComponents) addCounts(counts);
      return;
    }

    const max = remainingUnits - minUnits * (remainingParts - 1);
    for (let count = minUnits; count <= max; count++) {
      rec(remainingParts - 1, remainingUnits - count, [...current, count]);
    }
  };

  rec(parts, totalUnits, []);

  // Equal thirds are the only non-grid special case kept for all grid modes.
  // It stays as the exact 1:1:1 recipe so the printable sequence is not rounded
  // to a 5% percentage representation.
  if (parts === 3) addCounts([1, 1, 1]);

  return out;
}

function makeBlendCandidates(
  slots: PhysicalSlot[],
  maxComponents: 1 | 2 | 3,
  recipeResolution: MixingRecipeResolution,
): BlendCandidate[] {
  const candidates = slots.filter((slot) => slot.slot >= 1 && slot.slot <= 8);
  if (candidates.length === 0) return [];
  const totalUnits = BLEND_TOTAL_UNITS;
  const out: BlendCandidate[] = [];
  const maxSize = Math.min(maxComponents, candidates.length) as 1 | 2 | 3;

  for (let size = 1; size <= maxSize; size++) {
    const countSets = buildUnitCountCompositions(size, totalUnits, recipeResolution);
    for (const subset of combinations(candidates, size)) {
      for (const unitCounts of countSets) {
        const totalCount = Math.max(
          1,
          unitCounts.reduce((sum, count) => sum + count, 0),
        );
        const ratios = unitCounts.map((count) => count / totalCount);
        const active: SnappedActiveRatio[] = subset.map((slot, index) => ({
          slot,
          ratio: ratios[index],
          unitCount: unitCounts[index],
        }));
        const canonical = buildCanonicalCycle(
          active.map((item) => ({
            extruder: item.slot.slot,
            ratio: item.ratio,
            count: item.unitCount,
          })),
        );
        if (canonical.sequence.length === 0) continue;
        const fdm = mixFilamentsRgb(
          active.map((item, index) => ({
            rgb: item.slot.filament.effectiveRgb,
            ratio: canonical.counts[index] ?? item.unitCount,
          })),
        );
        const fdmChroma = labChroma(fdm.lab);
        const fdmHue = labHueDegrees(fdm.lab);
        const rgbChroma = colourChroma(fdm.rgb);
        const tinyComponentPenalty = ratios.filter(
          (ratio) => ratio > 0 && ratio < 0.08,
        ).length * 0.08;
        const componentPenalty = (subset.length - 1) * 0.04;
        out.push({
          subset,
          ratios,
          unitCounts: canonical.counts,
          active,
          sequence: canonical.sequence,
          sequenceKey: layerSequenceKey(canonical.sequence),
          fdmRgb: fdm.rgb,
          fdmLab: fdm.lab,
          fdmChroma,
          fdmHue,
          rgbChroma,
          complexityPenalty: tinyComponentPenalty + componentPenalty,
          layerAverageRgb: effectiveRgbFromCounts(active, canonical.counts),
        });
      }
    }
  }

  return out;
}

function getBlendCandidates(
  slots: PhysicalSlot[],
  maxComponents: 1 | 2 | 3,
  recipeResolution: MixingRecipeResolution,
): BlendCandidate[] {
  let bySettings = blendCandidateCache.get(slots);
  if (!bySettings) {
    bySettings = new Map<string, BlendCandidate[]>();
    blendCandidateCache.set(slots, bySettings);
  }
  const slotKey = slots
    .map(
      (slot) =>
        `${slot.slot}:${slot.filament.effectiveRgb[0]},${slot.filament.effectiveRgb[1]},${slot.filament.effectiveRgb[2]}`,
    )
    .join(";");
  const key = `${maxComponents}|${recipeResolution}|${slotKey}`;
  const cached = bySettings.get(key);
  if (cached) return cached;
  const built = makeBlendCandidates(slots, maxComponents, recipeResolution);
  bySettings.set(key, built);
  return built;
}

function candidateScore(
  targetLab: LAB,
  targetChroma: number,
  targetHue: number,
  targetRgbChroma: number,
  candidate: BlendCandidate,
  baseDistance: number,
  accentProtection: AccentProtectionMode,
  mixPriority: VirtualMixPriorityMode,
  mappingStrategy: MappingStrategyMode,
  targetWeightShare: number,
  previewLightnessOffset: number,
): number {
  // Preview brightness must be monotonic and must not make a brighter
  // setting choose a darker printable layer sequence. Keep mixture selection
  // anchored to the calibrated Prusa-FDM prediction; apply the brightness
  // offset only to the displayed virtual colour after the sequence is chosen.
  void previewLightnessOffset;
  const candidateLab = candidate.fdmLab;
  let score = baseDistance;

  const candidateChroma = candidate.fdmChroma;
  const candidateHue = candidate.fdmHue;
  const hueGap = targetChroma >= 6 && candidateChroma >= 4
    ? hueDistanceDegrees(targetHue, candidateHue)
    : 0;

  // Keep the Prusa-calibrated FDM model as the primary score.  These are only
  // tie-breakers/guards, not alternate colour models.
  if (accentProtection !== "off" && targetChroma >= 12) {
    const strong = accentProtection === "strong" || mixPriority === "avoid-muddy";
    const allowedHueGap = strong ? 28 : 40;
    if (hueGap > allowedHueGap) score += (hueGap - allowedHueGap) * (strong ? 0.22 : 0.12);
    if (candidateChroma < targetChroma * (strong ? 0.42 : 0.32))
      score += (targetChroma * (strong ? 0.42 : 0.32) - candidateChroma) * (strong ? 0.16 : 0.08);
  }

  if (mixPriority === "preserve-hue" && targetChroma >= 16) {
    if (hueGap > 24) score += (hueGap - 24) * 0.18;
  } else if (mixPriority === "avoid-muddy" && targetChroma >= 16) {
    // Keep this mode conservative: favour same-hue candidates only when they
    // remain close to the calibrated Prusa FDM mixer colour match.
    if (hueGap > 22) score += (hueGap - 22) * 0.22;
    if (candidate.rgbChroma < targetRgbChroma * 0.45) score += 2.5;
  }

  if (mappingStrategy === "preserve-hue" && targetChroma >= 10) {
    if (hueGap > 14) score += (hueGap - 14) * 0.32;
    if (candidateChroma < targetChroma * 0.36)
      score += (targetChroma * 0.36 - candidateChroma) * 0.18;
  } else if (mappingStrategy === "preserve-accent" && targetChroma >= 12) {
    const smallRegion = targetWeightShare > 0 && targetWeightShare <= 0.025;
    const hueLimit = smallRegion ? 10 : 18;
    if (hueGap > hueLimit) score += (hueGap - hueLimit) * (smallRegion ? 0.42 : 0.24);
    const minimumChroma = targetChroma * (smallRegion ? 0.55 : 0.42);
    if (candidateChroma < minimumChroma)
      score += (minimumChroma - candidateChroma) * (smallRegion ? 0.24 : 0.14);
  } else if (mappingStrategy === "smooth" && targetChroma >= 4) {
    // Smooth mode avoids visibly harsh printable jumps by mildly preferring
    // less over-saturated candidates when several matches are otherwise close.
    if (candidateChroma > targetChroma * 1.35)
      score += (candidateChroma - targetChroma * 1.35) * 0.08;
  } else if (mappingStrategy === "warm-neutral") {
    // Browser-visible print simulation is especially sensitive to brown,
    // orange, skin and rust targets being mapped to green/olive mixtures.
    // Low-chroma colours also need tighter lightness/neutrality control than
    // plain DeltaE gives them in this palette-mapping context.
    score += warmNeutralGuardPenalty(targetLab, candidateLab, hueGap);
  }

  return score + candidate.complexityPenalty;
}

function clampLabLightness(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function adjustPreviewLightness(rgb: RGB, offset: number): RGB {
  if (!Number.isFinite(offset) || Math.abs(offset) < 0.001) return rgb;
  const lab = rgbToLab(rgb);
  return labToRgb({ ...lab, L: clampLabLightness(lab.L + offset) });
}


function bestBlendForColour(
  targetRgb: RGB,
  candidates: BlendCandidate[],
  accentProtection: AccentProtectionMode,
  mixPriority: VirtualMixPriorityMode,
  mappingStrategy: MappingStrategyMode,
  colourDifferenceMetric: ColourDifferenceMetric,
  targetWeightShare: number,
  previewLightnessOffset: number,
  previousSmoothLab: LAB | null = null,
): {
  subset: PhysicalSlot[];
  ratios: number[];
  active: SnappedActiveRatio[];
  sequence: number[];
  sequenceKey: string;
  unitCounts: number[];
  fdmRgb: RGB;
  fdmLab: LAB;
  layerAverageRgb: RGB;
  error: number;
  diagnosticError: number;
} | null {
  if (candidates.length === 0) return null;
  const targetLab = rgbToLab(targetRgb);
  const targetChroma = labChroma(targetLab);
  const targetHue = labHueDegrees(targetLab);
  const targetRgbChroma = colourChroma(targetRgb);

  let rawBestScore = Number.POSITIVE_INFINITY;
  let rawBestIndex = -1;
  let rawBestError = Number.POSITIVE_INFINITY;
  const smoothScores =
    mappingStrategy === "smooth" ? new Float64Array(candidates.length) : null;
  const smoothErrors =
    mappingStrategy === "smooth" ? new Float64Array(candidates.length) : null;

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const error = colourDistance(
      targetLab,
      candidate.fdmLab,
      colourDifferenceMetric,
    );
    const score = candidateScore(
      targetLab,
      targetChroma,
      targetHue,
      targetRgbChroma,
      candidate,
      error,
      accentProtection,
      mixPriority,
      mappingStrategy,
      targetWeightShare,
      previewLightnessOffset,
    );
    if (smoothScores) {
      smoothScores[index] = score;
      smoothErrors![index] = error;
    }
    if (score < rawBestScore) {
      rawBestScore = score;
      rawBestIndex = index;
      rawBestError = error;
    }
  }

  let bestIndex = rawBestIndex;
  let bestScore = rawBestScore;
  let bestError = rawBestError;
  if (
    mappingStrategy === "smooth" &&
    previousSmoothLab &&
    smoothScores &&
    smoothErrors
  ) {
    bestIndex = -1;
    bestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < candidates.length; index++) {
      const rawScore = smoothScores[index];
      const candidate = candidates[index];
      const score =
        rawScore <= rawBestScore + 7
          ? rawScore +
            colourDistance(
              previousSmoothLab,
              candidate.fdmLab,
              colourDifferenceMetric,
            ) *
              0.06
          : rawScore;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
        bestError = smoothErrors[index];
      }
    }
  }

  if (bestIndex < 0) return null;
  const best = candidates[bestIndex];
  return {
    subset: best.subset,
    ratios: best.ratios,
    active: best.active,
    sequence: best.sequence,
    sequenceKey: best.sequenceKey,
    unitCounts: best.unitCounts,
    fdmRgb: best.fdmRgb,
    fdmLab: best.fdmLab,
    layerAverageRgb: best.layerAverageRgb,
    error: bestError,
    diagnosticError: bestScore,
  };
}

function layerSequenceKey(sequence: number[]): string {
  return sequence.join("-");
}

function colourChroma(rgb: RGB): number {
  return (
    (Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2])) / 255
  );
}

function colourHue(rgb: RGB): number | null {
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

function colourHueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}


function effectiveMergeProtection(
  accentProtection: AccentProtectionMode,
  mixPriority: VirtualMixPriorityMode,
): AccentProtectionMode {
  // The priority dropdown must not replace the optical target-colour preview
  // with a raw RGB layer average.  It only controls how conservative display
  // merging is: hue-oriented modes keep more target colours separated when they
  // would otherwise share the same layer sequence.
  if (accentProtection === "strong") return "strong";
  if (mixPriority === "preserve-hue" || mixPriority === "avoid-muddy")
    return "strong";
  return accentProtection;
}

function compatibleForDisplayMerge(
  a: RGB,
  b: RGB,
  accentProtection: AccentProtectionMode = "balanced",
): boolean {
  const distance = Math.sqrt(squaredDistance(a, b));
  if (accentProtection === "off") return distance <= 34;
  const strong = accentProtection === "strong";
  const ah = colourHue(a);
  const bh = colourHue(b);
  const ac = colourChroma(a);
  const bc = colourChroma(b);
  const maxChroma = Math.max(ac, bc);
  const minChroma = Math.min(ac, bc);
  const chromaGap = Math.abs(ac - bc);

  // Always allow very close colours to collapse. These are normally sampling
  // noise or neighbouring tones from the same painted area.
  if (distance <= (strong ? 12 : 18)) return true;

  // Neutral and near-neutral colours can merge by RGB distance because hue is
  // unstable there. A chromatic colour, however, must not be averaged into a
  // neutral-looking mixture just because both use the same physical layer
  // sequence. That is the failure mode that hides small accents in the print
  // simulation.
  if (ah === null || bh === null || maxChroma < 0.075) {
    if (maxChroma >= (strong ? 0.07 : 0.1) && distance > (strong ? 10 : 16))
      return false;
    if (
      maxChroma >= (strong ? 0.055 : 0.075) &&
      minChroma < maxChroma * (strong ? 0.66 : 0.5) &&
      distance > (strong ? 9 : 14)
    )
      return false;
    return distance <= (strong ? 18 : 28);
  }

  const hueGap = colourHueDistance(ah, bh);

  // Generic accent protection: any chromatic hue family may be semantically
  // relevant, not just red. If two target colours differ clearly in hue or
  // saturation, keep separate virtual extruders even when their quantised layer
  // sequence is identical. Larger same-family regions are then still free to
  // merge with each other, but a small green/blue/cyan/red/yellow accent is not
  // swallowed by a larger differently coloured area.
  if (maxChroma >= (strong ? 0.075 : 0.12)) {
    if (hueGap > (strong ? 16 : 26) && distance > (strong ? 12 : 20))
      return false;
    if (hueGap > (strong ? 10 : 16) && distance > (strong ? 18 : 26))
      return false;
    if (chromaGap > (strong ? 0.11 : 0.2) && distance > (strong ? 15 : 24))
      return false;
    if (
      minChroma < maxChroma * (strong ? 0.64 : 0.48) &&
      distance > (strong ? 14 : 24)
    )
      return false;
  }

  // Same hue family: allow moderate tonal variation so broad, similar surfaces
  // still collapse instead of consuming virtual extruders.
  if (hueGap <= (strong ? 5 : 8))
    return (
      distance <= (strong ? 30 : 46) && chromaGap <= (strong ? 0.14 : 0.24)
    );
  if (hueGap <= (strong ? 9 : 14))
    return distance <= (strong ? 22 : 34) && chromaGap <= (strong ? 0.1 : 0.18);
  return distance <= (strong ? 16 : 26) && chromaGap <= (strong ? 0.08 : 0.12);
}

function comparePaletteForSmoothMapping(a: PaletteEntry, b: PaletteEntry): number {
  const al = rgbToLab(a.rgb);
  const bl = rgbToLab(b.rgb);
  const ac = labChroma(al);
  const bc = labChroma(bl);
  const an = ac < 6 ? 1 : 0;
  const bn = bc < 6 ? 1 : 0;
  if (an !== bn) return an - bn;
  if (an === 1) return al.L - bl.L || a.index - b.index;
  return labHueDegrees(al) - labHueDegrees(bl) || al.L - bl.L || a.index - b.index;
}

function poorMappingThreshold(metric: ColourDifferenceMetric): number {
  return metric === "ciede2000"
    ? POOR_MAPPING_DELTA_E2000
    : POOR_MAPPING_DELTA_E76;
}

function emptyMappingDiagnostics(
  metric: ColourDifferenceMetric = "ciede2000",
): VirtualMappingDiagnostics {
  return {
    targetPaletteCount: 0,
    averageError: 0,
    worstError: 0,
    poorMatchCount: 0,
    poorMatchThreshold: poorMappingThreshold(metric),
    collapsedTargetColours: 0,
  };
}

export function buildVirtualExtruderPlan(
  palette: PaletteEntry[],
  physicalSlots: PhysicalSlot[],
  options: Partial<VirtualExtruderPlanOptions> = {},
): VirtualExtruderPlan {
  const opts: VirtualExtruderPlanOptions = {
    maxComponents: options.maxComponents ?? 3,
    virtualStartId: options.virtualStartId ?? 6,
    purePhysicalThreshold: options.purePhysicalThreshold ?? 0.985,
    ratioStepPercent: options.ratioStepPercent,
    recipeResolution: options.recipeResolution ?? recipeResolutionFromLegacyStep(options.ratioStepPercent),
    accentProtection: options.accentProtection ?? "balanced",
    mixPriority: options.mixPriority ?? "accurate",
    mappingStrategy: options.mappingStrategy ?? "closest",
    colourDifferenceMetric: options.colourDifferenceMetric ?? "ciede2000",
    previewLightnessOffset: Number.isFinite(options.previewLightnessOffset)
      ? Math.max(-90, Math.min(30, options.previewLightnessOffset ?? -36))
      : -36,
  };
  const paletteToAssignment = new Map<
    number,
    | { kind: "physical"; extruder: number }
    | { kind: "virtual"; virtualId: number }
  >();
  const physicalOnlyByExtruder = new Map<number, PhysicalOnlyEntry>();
  const appendPhysicalOnly = (entry: PhysicalOnlyEntry) => {
    const existing = physicalOnlyByExtruder.get(entry.physicalExtruder);
    if (!existing) {
      physicalOnlyByExtruder.set(entry.physicalExtruder, entry);
      return;
    }
    existing.targetPaletteIndices.push(...entry.targetPaletteIndices);
    existing.targetPaletteIndices.sort((a, b) => a - b);
    existing.paletteIndex = existing.targetPaletteIndices[0] ?? existing.paletteIndex;
    existing.triangleCount += entry.triangleCount;
    existing.linearRgbError = Math.max(existing.linearRgbError, entry.linearRgbError);
  };
  const bySequence = new Map<
    string,
    VirtualBlendEntry & { weightedTargets: Array<{ rgb: RGB; weight: number }> }
  >();
  const blendCandidates = getBlendCandidates(
    physicalSlots,
    opts.maxComponents,
    opts.recipeResolution ?? recipeResolutionFromLegacyStep(opts.ratioStepPercent),
  );
  const totalPaletteWeight = Math.max(
    1,
    palette.reduce((sum, entry) => sum + Math.max(0, entry.count), 0),
  );
  const orderedPalette =
    opts.mappingStrategy === "smooth"
      ? [...palette].sort(comparePaletteForSmoothMapping)
      : palette;
  let previousSmoothLab: LAB | null = null;
  const mappingErrors: Array<{ error: number; weight: number }> = [];

  for (const p of orderedPalette) {
    const best = bestBlendForColour(
      p.rgb,
      blendCandidates,
      opts.accentProtection,
      opts.mixPriority,
      opts.mappingStrategy,
      opts.colourDifferenceMetric,
      Math.max(0, p.count) / totalPaletteWeight,
      opts.previewLightnessOffset,
      previousSmoothLab,
    );
    if (!best) continue;
    mappingErrors.push({ error: best.diagnosticError, weight: Math.max(1, p.count) });
    if (opts.mappingStrategy === "smooth") previousSmoothLab = best.fdmLab;

    const active = best.active;

    if (active.length === 0) continue;
    const dominant = active.reduce(
      (acc, item) => (item.ratio > acc.ratio ? item : acc),
      active[0],
    );
    if (active.length === 1 || dominant.ratio >= opts.purePhysicalThreshold) {
      const physicalRgb = dominant.slot.filament.effectiveRgb;
      const previewPhysicalRgb = adjustPreviewLightness(physicalRgb, opts.previewLightnessOffset);
      appendPhysicalOnly({
        paletteIndex: p.index,
        targetPaletteIndices: [p.index],
        targetRgb: p.rgb,
        physicalRgb: previewPhysicalRgb,
        physicalExtruder: dominant.slot.slot,
        triangleCount: p.count,
        linearRgbError: rgbError(p.rgb, physicalRgb),
      });
      paletteToAssignment.set(p.index, {
        kind: "physical",
        extruder: dominant.slot.slot,
      });
      continue;
    }

    if (best.sequence.length <= 1) {
      const ext = best.sequence[0] ?? dominant.slot.slot;
      const physicalRgb =
        physicalSlots.find((slot) => slot.slot === ext)?.filament
          .effectiveRgb ?? dominant.slot.filament.effectiveRgb;
      const previewPhysicalRgb = adjustPreviewLightness(physicalRgb, opts.previewLightnessOffset);
      appendPhysicalOnly({
        paletteIndex: p.index,
        targetPaletteIndices: [p.index],
        targetRgb: p.rgb,
        physicalRgb: previewPhysicalRgb,
        physicalExtruder: ext,
        triangleCount: p.count,
        linearRgbError: rgbError(p.rgb, physicalRgb),
      });
      paletteToAssignment.set(p.index, { kind: "physical", extruder: ext });
      continue;
    }

    const effectiveRgb = adjustPreviewLightness(best.fdmRgb, opts.previewLightnessOffset);
    const layerAverageRgb = best.layerAverageRgb;
    const effectiveError = best.error;
    const key = best.sequenceKey;
    const existing = bySequence.get(key);
    if (existing) {
      existing.targetPaletteIndices.push(p.index);
      existing.triangleCount += p.count;
      existing.linearRgbError = Math.max(
        existing.linearRgbError,
        effectiveError,
      );
      existing.weightedTargets.push({ rgb: p.rgb, weight: p.count });
      // Identical quantised layer sequences are one printable virtual mixture.
      // Coarse mixing steps such as 10%, 20%, or 25% intentionally collapse many
      // palette colours onto the same VE instead of keeping duplicate virtual
      // extruders for visually different target colours.
      existing.displayRgb = effectiveRgb;
      paletteToAssignment.set(p.index, {
        kind: "virtual",
        virtualId: existing.virtualId,
      });
      continue;
    }

    const sequenceCounts = new Map<number, number>();
    for (const extruder of best.sequence) {
      sequenceCounts.set(extruder, (sequenceCounts.get(extruder) ?? 0) + 1);
    }
    const sequenceLength = Math.max(1, best.sequence.length);
    const components: VirtualBlendComponent[] = [...sequenceCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([extruder, count]) => {
        const slot = physicalSlots.find((candidate) => candidate.slot === extruder);
        return {
          extruder,
          ratio: count / sequenceLength,
          count,
          rgb: slot?.filament.effectiveRgb ?? [0, 0, 0],
        };
      });

    const virtualId = opts.virtualStartId + bySequence.size;
    const entry: VirtualBlendEntry & {
      weightedTargets: Array<{ rgb: RGB; weight: number }>;
    } = {
      virtualId,
      displayRgb: effectiveRgb,
      layerAverageRgb,
      components,
      sequence: best.sequence,
      sequenceKey: key,
      targetPaletteIndices: [p.index],
      triangleCount: p.count,
      linearRgbError: effectiveError,
      weightedTargets: [{ rgb: p.rgb, weight: p.count }],
    };
    bySequence.set(key, entry);
    paletteToAssignment.set(p.index, { kind: "virtual", virtualId });
  }

  const virtualBlends = [...bySequence.values()].map(
    ({ weightedTargets: _weightedTargets, ...entry }) => entry,
  );
  virtualBlends.sort((a, b) => a.virtualId - b.virtualId);
  const physicalOnly = [...physicalOnlyByExtruder.values()].sort(
    (a, b) => a.paletteIndex - b.paletteIndex,
  );
  const assignedTargetCount = virtualBlends.reduce(
    (sum, entry) => sum + entry.targetPaletteIndices.length,
    0,
  ) + physicalOnly.reduce(
    (sum, entry) => sum + entry.targetPaletteIndices.length,
    0,
  );
  const printableAssignmentCount = virtualBlends.length + physicalOnly.length;
  const totalErrorWeight = mappingErrors.reduce((sum, item) => sum + item.weight, 0);
  const mappingThreshold = poorMappingThreshold(opts.colourDifferenceMetric);
  const mappingDiagnostics: VirtualMappingDiagnostics = mappingErrors.length > 0
    ? {
        targetPaletteCount: assignedTargetCount,
        averageError:
          mappingErrors.reduce((sum, item) => sum + item.error * item.weight, 0) /
          Math.max(1, totalErrorWeight),
        worstError: mappingErrors.reduce((max, item) => Math.max(max, item.error), 0),
        poorMatchCount: mappingErrors.filter((item) => item.error >= mappingThreshold).length,
        poorMatchThreshold: mappingThreshold,
        collapsedTargetColours: Math.max(0, assignedTargetCount - printableAssignmentCount),
      }
    : emptyMappingDiagnostics(opts.colourDifferenceMetric);
  return { virtualBlends, physicalOnly, paletteToAssignment, mappingDiagnostics };
}

export function virtualExtruderPlanToCsv(plan: VirtualExtruderPlan): string {
  const rows = [
    "assignment_type,id_or_extruder,display_colour,layer_average_colour,triangle_count,palette_indices,components,layer_sequence,linear_rgb_error",
  ];
  for (const entry of plan.virtualBlends) {
    const components = entry.components
      .map(
        (c) =>
          `E${c.extruder}:${((c.count / entry.sequence.length) * 100).toFixed(1)}%(${c.count})`,
      )
      .join("+");
    rows.push(
      [
        "virtual",
        `VE${entry.virtualId}`,
        rgbToHex(entry.displayRgb),
        rgbToHex(entry.layerAverageRgb),
        entry.triangleCount,
        `"${entry.targetPaletteIndices.join(" ")}"`,
        `"${components}"`,
        `"${entry.sequence.map((ext) => `E${ext}`).join(" ")}"`,
        entry.linearRgbError.toFixed(3),
      ].join(","),
    );
  }
  for (const entry of plan.physicalOnly) {
    rows.push(
      [
        "physical",
        `E${entry.physicalExtruder}`,
        rgbToHex(entry.physicalRgb),
        rgbToHex(entry.physicalRgb),
        entry.triangleCount,
        `"${entry.targetPaletteIndices.join(" ")}"`,
        `"E${entry.physicalExtruder}:100%"`,
        `"E${entry.physicalExtruder}"`,
        entry.linearRgbError.toFixed(3),
      ].join(","),
    );
  }
  return rows.join("\n") + "\n";
}
