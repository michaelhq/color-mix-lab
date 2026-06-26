import type {
  AccentProtectionMode,
  PaletteEntry,
  PhysicalSlot,
  RGB,
  VirtualMixPriorityMode,
} from "./types";
import { clamp255, rgbToHex, squaredDistance } from "./colour";
import {
  deltaE76,
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

export interface VirtualExtruderPlan {
  virtualBlends: VirtualBlendEntry[];
  physicalOnly: PhysicalOnlyEntry[];
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
  ratioStepPercent: number;
  accentProtection: AccentProtectionMode;
  mixPriority: VirtualMixPriorityMode;
  /**
   * LAB L* offset for the preview colour model. The exported layer sequence is
   * kept independent from display calibration so slicer output remains stable.
   */
  previewLightnessOffset: number;
}

// Virtual mixtures are generated as discrete layer sequences. The UI exposes
// coarse mixing steps; internally all supported steps are represented on a
// 2.5%-unit grid so exported layer-sequence semantics remain stable for
// visible UI values such as 2.5%, 5%, 10%, 20%, and 25%.
const BLEND_PERCENT_UNIT = 2.5;
const BLEND_TOTAL_UNITS = Math.round(100 / BLEND_PERCENT_UNIT);
const BLEND_WEIGHT_RESOLUTION = 64;
const BLEND_QUANTISE_MAX_ERROR = 0.03;

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

interface BlendCandidate {
  subset: PhysicalSlot[];
  ratios: number[];
  unitCounts: number[];
  active: SnappedActiveRatio[];
  sequence: number[];
  sequenceKey: string;
  fdmRgb: RGB;
  fdmLab: LAB;
  layerAverageRgb: RGB;
}

function stepPercentToUnits(ratioStepPercent: number): number {
  const safeStep = Number.isFinite(ratioStepPercent) ? ratioStepPercent : 5;
  return Math.max(1, Math.round(safeStep / BLEND_PERCENT_UNIT));
}

function buildUnitCountCompositions(
  parts: number,
  totalUnits: number,
  stepUnits: number,
): number[][] {
  if (parts <= 1) return [[totalUnits]];

  const minUnits = Math.max(1, stepUnits);
  const allowedOffGridComponents = totalUnits % stepUnits === 0 ? 0 : 1;
  const out: number[][] = [];

  const rec = (
    remainingParts: number,
    remainingUnits: number,
    current: number[],
  ) => {
    if (remainingParts === 1) {
      if (remainingUnits < minUnits) return;
      const counts = [...current, remainingUnits];
      const offGrid = counts.filter((count) => count % stepUnits !== 0).length;
      if (offGrid <= allowedOffGridComponents) out.push(counts);
      return;
    }

    const max = remainingUnits - minUnits * (remainingParts - 1);
    for (let count = minUnits; count <= max; count++) {
      rec(remainingParts - 1, remainingUnits - count, [...current, count]);
    }
  };

  rec(parts, totalUnits, []);
  return out;
}

function makeBlendCandidates(
  slots: PhysicalSlot[],
  maxComponents: 1 | 2 | 3,
  ratioStepPercent: number,
): BlendCandidate[] {
  const candidates = slots.filter((slot) => slot.slot >= 1 && slot.slot <= 8);
  if (candidates.length === 0) return [];
  const totalUnits = BLEND_TOTAL_UNITS;
  const stepUnits = stepPercentToUnits(ratioStepPercent);
  const out: BlendCandidate[] = [];
  const maxSize = Math.min(maxComponents, candidates.length) as 1 | 2 | 3;

  for (let size = 1; size <= maxSize; size++) {
    const countSets = buildUnitCountCompositions(size, totalUnits, stepUnits);
    for (const subset of combinations(candidates, size)) {
      for (const unitCounts of countSets) {
        const ratios = unitCounts.map((count) => count / totalUnits);
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
        out.push({
          subset,
          ratios,
          unitCounts: canonical.counts,
          active,
          sequence: canonical.sequence,
          sequenceKey: layerSequenceKey(canonical.sequence),
          fdmRgb: fdm.rgb,
          fdmLab: fdm.lab,
          layerAverageRgb: effectiveRgbFromCounts(active, canonical.counts),
        });
      }
    }
  }

  return out;
}

function candidateScore(
  targetRgb: RGB,
  targetLab: LAB,
  candidate: BlendCandidate,
  accentProtection: AccentProtectionMode,
  mixPriority: VirtualMixPriorityMode,
  previewLightnessOffset: number,
): number {
  // Preview brightness must be monotonic and must not make a brighter
  // setting choose a darker printable layer sequence. Keep mixture selection
  // anchored to the calibrated Prusa-FDM prediction; apply the brightness
  // offset only to the displayed virtual colour after the sequence is chosen.
  void previewLightnessOffset;
  const candidateLab = candidate.fdmLab;
  const candidateRgb = candidate.fdmRgb;
  let score = deltaE76(targetLab, candidateLab);

  const targetChroma = labChroma(targetLab);
  const candidateChroma = labChroma(candidateLab);
  const targetHue = labHueDegrees(targetLab);
  const candidateHue = labHueDegrees(candidateLab);
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
    const rgbChroma = colourChroma(candidateRgb);
    if (rgbChroma < colourChroma(targetRgb) * 0.45) score += 2.5;
  }

  const tinyComponentPenalty = candidate.ratios.filter((r) => r > 0 && r < 0.08).length * 0.08;
  const componentPenalty = (candidate.subset.length - 1) * 0.04;
  return score + tinyComponentPenalty + componentPenalty;
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
  previewLightnessOffset: number,
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
} | null {
  if (candidates.length === 0) return null;
  const targetLab = rgbToLab(targetRgb);
  let best: (BlendCandidate & { score: number; error: number }) | null = null;
  for (const candidate of candidates) {
    const error = deltaE76(targetLab, candidate.fdmLab);
    const score = candidateScore(
      targetRgb,
      targetLab,
      candidate,
      accentProtection,
      mixPriority,
      previewLightnessOffset,
    );
    if (!best || score < best.score) best = { ...candidate, score, error };
  }
  if (!best) return null;
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
    error: best.error,
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

export function buildVirtualExtruderPlan(
  palette: PaletteEntry[],
  physicalSlots: PhysicalSlot[],
  options: Partial<VirtualExtruderPlanOptions> = {},
): VirtualExtruderPlan {
  const opts: VirtualExtruderPlanOptions = {
    maxComponents: options.maxComponents ?? 3,
    virtualStartId: options.virtualStartId ?? 6,
    purePhysicalThreshold: options.purePhysicalThreshold ?? 0.985,
    ratioStepPercent: options.ratioStepPercent ?? 5,
    accentProtection: options.accentProtection ?? "balanced",
    mixPriority: options.mixPriority ?? "accurate",
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
  const blendCandidates = makeBlendCandidates(
    physicalSlots,
    opts.maxComponents,
    opts.ratioStepPercent,
  );

  for (const p of palette) {
    const best = bestBlendForColour(
      p.rgb,
      blendCandidates,
      opts.accentProtection,
      opts.mixPriority,
      opts.previewLightnessOffset,
    );
    if (!best) continue;

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
  return { virtualBlends, physicalOnly, paletteToAssignment };
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
