import type {
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

export interface TargetMappingRecipeComponent {
  extruder: number;
  ratio: number;
  count: number;
}

export interface TargetMappingDiagnostic {
  paletteIndex: number;
  targetRgb: RGB;
  targetLab: LAB;
  assignment:
    | { kind: "physical"; extruder: number }
    | { kind: "virtual"; virtualId: number };
  recipe: TargetMappingRecipeComponent[];
  predictedRgb: RGB;
  predictedLab: LAB;
  deltaE: number;
  hueShiftDegrees: number | null;
  lightnessShift: number;
}

export interface VirtualExtruderPlan {
  virtualBlends: VirtualBlendEntry[];
  physicalOnly: PhysicalOnlyEntry[];
  mappingDiagnostics: VirtualMappingDiagnostics;
  targetMappings: TargetMappingDiagnostic[];
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

// Coarse recipe grids can make a perceptually acceptable DeltaE match look
// obviously wrong in the print preview: typically too dark or shifted from a
// warm beige/orange target into olive/green. These are common plausibility
// guards shared by every mapping strategy. Strategy-specific scoring still runs
// first and remains the primary selector; the guards only replace a result when
// a materially better lightness / warm-hue alternative is still close enough in
// the underlying colour-difference metric.
const COARSE_LIGHTNESS_GUARD_MIN_TARGET_L = 55;
const COARSE_LIGHTNESS_GUARD_MIN_DARKENING = 4.5;
const COARSE_LIGHTNESS_GUARD_MIN_IMPROVEMENT = 2.5;
const COARSE_LIGHTNESS_GUARD_L_WEIGHT = 0.45;
const COARSE_WARM_GUARD_LIGHTNESS_WEIGHT = 0.75;
const COARSE_WARM_GUARD_GREEN_A_FREE = -2.0;
const COARSE_WARM_GUARD_GREEN_A_WEIGHT = 1.20;
const COMMON_WARM_GREEN_MIN_IMPROVEMENT = 0.5;

function usesCoarsePerceptualGuards(
  recipeResolution: MixingRecipeResolution,
): boolean {
  return (
    recipeResolution === "grid10" ||
    recipeResolution === "grid20" ||
    recipeResolution === "grid25" ||
    recipeResolution === "thirds" ||
    recipeResolution === "half-thirds"
  );
}

function coarseLightnessGuardBaseAllowance(
  metric: ColourDifferenceMetric,
): number {
  return metric === "ciede2000" ? 5.0 : 10.0;
}

function commonWarmGreenGuardBaseAllowance(
  metric: ColourDifferenceMetric,
): number {
  return metric === "ciede2000" ? 9.0 : 18.0;
}

function closestWarmGuardBaseAllowance(
  metric: ColourDifferenceMetric,
): number {
  return metric === "ciede2000" ? 9.0 : 18.0;
}

function smoothTransitionScoreAllowance(
  metric: ColourDifferenceMetric,
): number {
  return metric === "ciede2000" ? 3.0 : 7.0;
}

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

function isWarmClosestGuardTarget(lab: LAB): boolean {
  const chroma = labChroma(lab);
  const hue = labHueDegrees(lab);
  return chroma >= 6 && lab.a >= -2 && lab.b >= 5 && hue >= 18 && hue <= 100;
}

function warmClosestGuardValue(
  targetLab: LAB,
  candidate: BlendCandidate,
  baseDistance: number,
): number {
  const lightnessGap = Math.abs(candidate.fdmLab.L - targetLab.L);
  const greenDrift = Math.max(
    0,
    COARSE_WARM_GUARD_GREEN_A_FREE - candidate.fdmLab.a,
  );
  return (
    baseDistance +
    candidate.complexityPenalty +
    lightnessGap * COARSE_WARM_GUARD_LIGHTNESS_WEIGHT +
    greenDrift * COARSE_WARM_GUARD_GREEN_A_WEIGHT
  );
}

function isGreenOliveCandidate(lab: LAB): boolean {
  // In CIELAB, genuinely green/olive drift is characterised by a negative a*
  // component. Hue alone is not sufficient: yellow/ochre colours around 76-85°
  // are warm and must not be misclassified as green merely because their Lab
  // hue sits near the yellow/green boundary.
  return labChroma(lab) >= 5 && lab.a < -2 && lab.b > -4;
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

function cumulativeGridStepUnits(
  recipeResolution: MixingRecipeResolution,
): number[] {
  switch (recipeResolution) {
    case "grid5":
      // A 5% grid already contains every coarser 10%, 20%, 25% and 50% recipe.
      return [1];
    case "grid10":
      // Preserve all recipes that were available at 20% and 25% so choosing
      // a finer grid cannot remove a previously printable coarse recipe.
      return [2, 4, 5];
    case "grid20":
      // 20% and 25% are not divisor-related grids. Keep the 25% recipes as
      // well so moving from 25% to 20% cannot make the candidate gamut worse.
      return [4, 5];
    case "grid25":
      return [5];
    case "thirds":
    case "half-thirds":
      return [];
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

  for (const stepUnits of cumulativeGridStepUnits(recipeResolution)) {
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
  }

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

  // Keep the Prusa-calibrated FDM model as the primary score. These are only
  // tie-breakers/guards, not alternate colour models.
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
    // Mapping-only accent protection. Target-palette accent preservation is a
    // separate palette-reduction setting and must not alter this score. Avoid
    // treating every small, lightly chromatic cream/beige patch as a saturated
    // accent: the small-region boost starts at a higher target chroma.
    const smallRegion =
      targetWeightShare > 0 &&
      targetWeightShare <= 0.025 &&
      targetChroma >= 18;
    const hueLimit = smallRegion ? 10 : 18;
    if (hueGap > hueLimit)
      score += (hueGap - hueLimit) * (smallRegion ? 0.42 : 0.24);
    const minimumChroma = targetChroma * (smallRegion ? 0.55 : 0.42);
    if (candidateChroma < minimumChroma)
      score +=
        (minimumChroma - candidateChroma) *
        (smallRegion ? 0.24 : 0.14);
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
  mixPriority: VirtualMixPriorityMode,
  mappingStrategy: MappingStrategyMode,
  colourDifferenceMetric: ColourDifferenceMetric,
  targetWeightShare: number,
  previewLightnessOffset: number,
  recipeResolution: MixingRecipeResolution,
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
  let minimumBaseError = Number.POSITIVE_INFINITY;
  const candidateScores = new Float64Array(candidates.length);
  const candidateErrors = new Float64Array(candidates.length);

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
      mixPriority,
      mappingStrategy,
      targetWeightShare,
      previewLightnessOffset,
    );
    candidateErrors[index] = error;
    candidateScores[index] = score;
    minimumBaseError = Math.min(minimumBaseError, error);

    const scoreWins = score < rawBestScore - 1e-9;
    const scoreTies = Math.abs(score - rawBestScore) <= 1e-9;
    const errorWinsTie = scoreTies && error < rawBestError - 1e-9;
    const complexityWinsTie =
      scoreTies &&
      Math.abs(error - rawBestError) <= 1e-9 &&
      (rawBestIndex < 0 ||
        candidate.complexityPenalty <
          candidates[rawBestIndex].complexityPenalty - 1e-9);
    if (scoreWins || errorWinsTie || complexityWinsTie) {
      rawBestScore = score;
      rawBestIndex = index;
      rawBestError = error;
    }
  }

  let bestIndex = rawBestIndex;
  let bestScore = rawBestScore;
  let bestError = rawBestError;

  if (mappingStrategy === "smooth" && previousSmoothLab) {
    const scoreAllowance = smoothTransitionScoreAllowance(
      colourDifferenceMetric,
    );
    bestIndex = rawBestIndex;
    bestScore = rawBestScore;
    bestError = rawBestError;
    let bestSmoothValue = rawBestScore;

    for (let index = 0; index < candidates.length; index++) {
      const rawScore = candidateScores[index];
      if (rawScore > rawBestScore + scoreAllowance) continue;
      const continuityPenalty =
        colourDistance(
          previousSmoothLab,
          candidates[index].fdmLab,
          colourDifferenceMetric,
        ) * 0.06;
      const smoothValue = rawScore + continuityPenalty;
      if (
        smoothValue < bestSmoothValue - 1e-9 ||
        (Math.abs(smoothValue - bestSmoothValue) <= 1e-9 &&
          candidateErrors[index] < bestError - 1e-9)
      ) {
        bestSmoothValue = smoothValue;
        bestIndex = index;
        bestScore = rawScore;
        bestError = candidateErrors[index];
      }
    }
  }

  // Common coarse-grid lightness guard. It deliberately evaluates eligibility
  // against the underlying colour difference rather than the strategy score:
  // strategy penalties must not lock in an obviously too-dark result. This is
  // intentionally limited to severe coarse-grid lightness loss; normal cases
  // remain controlled by the selected mapping strategy.
  if (
    bestIndex >= 0 &&
    usesCoarsePerceptualGuards(recipeResolution) &&
    targetLab.L >= COARSE_LIGHTNESS_GUARD_MIN_TARGET_L
  ) {
    const currentBest = candidates[bestIndex];
    const currentDarkening = targetLab.L - currentBest.fdmLab.L;
    if (currentDarkening >= COARSE_LIGHTNESS_GUARD_MIN_DARKENING) {
      const currentLightnessGap = Math.abs(currentBest.fdmLab.L - targetLab.L);
      let guardedIndex = bestIndex;
      let guardedScore = bestScore;
      let guardedError = bestError;
      let guardedValue =
        bestError +
        currentLightnessGap * COARSE_LIGHTNESS_GUARD_L_WEIGHT;
      const baseAllowance = coarseLightnessGuardBaseAllowance(
        colourDifferenceMetric,
      );

      for (let index = 0; index < candidates.length; index++) {
        if (index === bestIndex) continue;
        const candidate = candidates[index];
        const error = candidateErrors[index];
        if (error > minimumBaseError + baseAllowance) continue;

        const lightnessGap = Math.abs(candidate.fdmLab.L - targetLab.L);
        if (
          lightnessGap >
          currentLightnessGap - COARSE_LIGHTNESS_GUARD_MIN_IMPROVEMENT
        )
          continue;

        const score = candidateScores[index];
        const guardValue =
          error + lightnessGap * COARSE_LIGHTNESS_GUARD_L_WEIGHT;
        if (guardValue + 1e-9 < guardedValue) {
          guardedIndex = index;
          guardedScore = score;
          guardedError = error;
          guardedValue = guardValue;
        }
      }

      if (guardedIndex !== bestIndex) {
        bestIndex = guardedIndex;
        bestScore = guardedScore;
        bestError = guardedError;
      }
    }
  }

  // Common warm->green/olive guard. It is intentionally narrow: it only runs
  // when the selected candidate is visibly green/olive for an actually warm
  // brown/orange/rust target. Real green targets are therefore left untouched.
  if (
    bestIndex >= 0 &&
    usesCoarsePerceptualGuards(recipeResolution) &&
    isWarmBrownOrangeRustTarget(targetLab) &&
    isGreenOliveCandidate(candidates[bestIndex].fdmLab)
  ) {
    const current = candidates[bestIndex];
    const currentHueGap = hueDistanceDegrees(
      targetHue,
      current.fdmHue,
    );
    const currentLightnessGap = Math.abs(current.fdmLab.L - targetLab.L);
    let guardedIndex = bestIndex;
    let guardedScore = bestScore;
    let guardedError = bestError;
    let guardedValue =
      bestError + currentLightnessGap * 0.30 + currentHueGap * 0.06 + 5.0;
    const baseAllowance = commonWarmGreenGuardBaseAllowance(
      colourDifferenceMetric,
    );

    for (let index = 0; index < candidates.length; index++) {
      if (index === bestIndex) continue;
      const candidate = candidates[index];
      if (isGreenOliveCandidate(candidate.fdmLab)) continue;
      const error = candidateErrors[index];
      if (error > minimumBaseError + baseAllowance) continue;
      const lightnessGap = Math.abs(candidate.fdmLab.L - targetLab.L);
      if (lightnessGap > currentLightnessGap + 3) continue;
      const hueGap =
        candidate.fdmChroma >= 4
          ? hueDistanceDegrees(targetHue, candidate.fdmHue)
          : 0;
      const strategyPenalty = Math.max(0, candidateScores[index] - error);
      const guardValue =
        error +
        lightnessGap * 0.30 +
        hueGap * 0.06 +
        strategyPenalty * 0.15;
      if (guardValue + COMMON_WARM_GREEN_MIN_IMPROVEMENT < guardedValue) {
        guardedIndex = index;
        guardedScore = candidateScores[index];
        guardedError = error;
        guardedValue = guardValue;
      }
    }

    if (guardedIndex !== bestIndex) {
      bestIndex = guardedIndex;
      bestScore = guardedScore;
      bestError = guardedError;
    }
  }

  // Closest-match keeps the broader warm/lightness reranker introduced for the
  // 10/20/25% grids. Other strategies have their own semantic scoring and only use
  // the two common plausibility guards above.
  if (
    bestIndex >= 0 &&
    mappingStrategy === "closest" &&
    usesCoarsePerceptualGuards(recipeResolution) &&
    isWarmClosestGuardTarget(targetLab)
  ) {
    const baseAllowance = closestWarmGuardBaseAllowance(
      colourDifferenceMetric,
    );
    let guardedIndex = bestIndex;
    let guardedScore = bestScore;
    let guardedError = bestError;
    let guardedValue = warmClosestGuardValue(
      targetLab,
      candidates[bestIndex],
      bestError,
    );

    for (let index = 0; index < candidates.length; index++) {
      if (index === bestIndex) continue;
      const candidate = candidates[index];
      const error = candidateErrors[index];
      if (error > minimumBaseError + baseAllowance) continue;

      const guardValue = warmClosestGuardValue(targetLab, candidate, error);
      if (guardValue + 0.25 < guardedValue) {
        guardedIndex = index;
        guardedError = error;
        guardedValue = guardValue;
        guardedScore = candidateScores[index];
      }
    }

    if (guardedIndex !== bestIndex) {
      bestIndex = guardedIndex;
      bestScore = guardedScore;
      bestError = guardedError;
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
    // Diagnostics report the actual colour-difference metric, not strategy
    // penalties. This keeps Average/Worst/Poor matches comparable between the
    // five mapping strategies.
    diagnosticError: bestError,
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
  const targetMappings: TargetMappingDiagnostic[] = [];

  for (const p of orderedPalette) {
    const best = bestBlendForColour(
      p.rgb,
      blendCandidates,
      opts.mixPriority,
      opts.mappingStrategy,
      opts.colourDifferenceMetric,
      Math.max(0, p.count) / totalPaletteWeight,
      opts.previewLightnessOffset,
      opts.recipeResolution ??
        recipeResolutionFromLegacyStep(opts.ratioStepPercent),
      previousSmoothLab,
    );
    if (!best) continue;
    mappingErrors.push({ error: best.diagnosticError, weight: Math.max(1, p.count) });
    if (opts.mappingStrategy === "smooth") previousSmoothLab = best.fdmLab;

    const targetLab = rgbToLab(p.rgb);
    const targetChroma = labChroma(targetLab);
    const predictedChroma = labChroma(best.fdmLab);
    const targetHue = labHueDegrees(targetLab);
    const predictedHue = labHueDegrees(best.fdmLab);
    const hueShiftDegrees =
      targetChroma >= 4 && predictedChroma >= 4
        ? ((predictedHue - targetHue + 540) % 360) - 180
        : null;
    const recipeCounts = new Map<number, number>();
    for (const extruder of best.sequence)
      recipeCounts.set(extruder, (recipeCounts.get(extruder) ?? 0) + 1);
    const recipeLength = Math.max(1, best.sequence.length);
    const diagnosticRecipe: TargetMappingRecipeComponent[] = [
      ...recipeCounts.entries(),
    ]
      .sort((a, b) => a[0] - b[0])
      .map(([extruder, count]) => ({
        extruder,
        count,
        ratio: count / recipeLength,
      }));
    const recordTargetMapping = (
      assignment:
        | { kind: "physical"; extruder: number }
        | { kind: "virtual"; virtualId: number },
    ) => {
      targetMappings.push({
        paletteIndex: p.index,
        targetRgb: p.rgb,
        targetLab,
        assignment,
        recipe: diagnosticRecipe,
        predictedRgb: best.fdmRgb,
        predictedLab: best.fdmLab,
        deltaE: best.diagnosticError,
        hueShiftDegrees,
        lightnessShift: best.fdmLab.L - targetLab.L,
      });
    };

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
      const assignment = {
        kind: "physical" as const,
        extruder: dominant.slot.slot,
      };
      paletteToAssignment.set(p.index, assignment);
      recordTargetMapping(assignment);
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
      const assignment = { kind: "physical" as const, extruder: ext };
      paletteToAssignment.set(p.index, assignment);
      recordTargetMapping(assignment);
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
      const assignment = {
        kind: "virtual" as const,
        virtualId: existing.virtualId,
      };
      paletteToAssignment.set(p.index, assignment);
      recordTargetMapping(assignment);
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
    const assignment = { kind: "virtual" as const, virtualId };
    paletteToAssignment.set(p.index, assignment);
    recordTargetMapping(assignment);
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
  targetMappings.sort((a, b) => a.paletteIndex - b.paletteIndex);
  return {
    virtualBlends,
    physicalOnly,
    paletteToAssignment,
    mappingDiagnostics,
    targetMappings,
  };
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
