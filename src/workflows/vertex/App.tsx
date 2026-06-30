import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AccentProtectionMode,
  ColourAdjustments,
  Filament,
  MappingStrategyMode,
  MeshModel,
  PaletteEntry,
  PhysicalSlot,
  RGB,
  Vec3,
  VirtualMixPriorityMode,
} from "./core/types";
import { adjustColour, defaultAdjustments, rgbToHex } from "./core/colour";
import { parseObjFile } from "./core/objParser";
import { medianCutPalette } from "./core/quantize";
import { downloadBlob, downloadText, paletteToCsv } from "./core/exportCsv";
import {
  filamentsFromHexText,
  filamentsFromPreset,
  presetSlotCount,
  physicalColourPresetColourNames,
  filamentsFromTemplateColours,
  fixedSlotsFromFilaments,
  parseFilamentList,
  slotsToCsv,
  suggestPhysicalSlots,
} from "./core/filaments";
import { readTemplate3mf, type Template3mfInfo } from "./core/template3mf";
import {
  buildPrusa3mfBlob,
  type ExportBedSource,
  type ExportCoordinateMode,
} from "./core/export3mf";
import {
  buildVirtualExtruderPlan,
  virtualExtruderPlanToCsv,
  type PhysicalOnlyEntry,
  type VirtualBlendEntry,
  type VirtualExtruderPlan,
} from "./core/virtualExtruders";
import { ThreePreview, type ThreePreviewHandle } from "./ui/ThreePreview";
import { getDict, Lang } from "./i18n";
import {
  applyOrientationMatrixToVec3,
  composeOrientationMatrices,
  IDENTITY_ORIENTATION_MATRIX,
  isIdentityOrientationMatrix,
  isModelBottomSide,
  isOrientationMatrix,
  orientationMatrixForAxisAngle,
  orientationMatrixForBottomSide,
  orientationMatrixForQuarterTurn,
  type ModelBottomSide,
  type ModelRotationAxis,
  type ModelRotationCommand,
  type OrientationMatrix,
} from "../common/modelOrientation";

type View = "front" | "back" | "left" | "right" | "top" | "bottom";
type PreviewMode = "adjusted" | "quantized" | "print";
type ResolvedPreviewBackground = "light" | "dark";
type PreviewBackground = "auto" | ResolvedPreviewBackground;
type ThemeMode = "system" | "light" | "dark";
type WebglLodMode = "off" | "tiny" | "small" | "medium";
type PreviewDisplayMode = "shaded" | "flat";
type PhysicalColourSource = "preset" | "template" | "manual" | "suggestion";
type SidebarTab =
  | "model"
  | "orientation"
  | "adjustment"
  | "palette"
  | "template"
  | "physical"
  | "filaments"
  | "export"
  | "settings";
type SuggestionMode = "balanced" | "dominant" | "wide" | "expert";
type VirtualPlanFilter = "all" | "virtual" | "physical" | "merged";
type FilamentSortKey = "assign" | "name" | "material" | "colour";
type SortDirection = "asc" | "desc";
type FilamentSlotMode = "suggested" | "manual";
type BrowserFamily = "firefox" | "edge" | "chrome" | "other";
type ProjectPart = "settings" | "model" | "template" | "filamentList";

interface ProjectPartSelection {
  settings: boolean;
  model: boolean;
  template: boolean;
  filamentList: boolean;
}

type AssignmentOverride =
  | { kind: "physical"; extruder: number }
  | { kind: "merge"; targetPaletteIndex: number };

type ProgressKind =
  | "load"
  | "palette"
  | "preview"
  | "suggestion"
  | "export"
  | "adjustment"
  | "orientation"
  | "project";

interface ProgressRun {
  kind: ProgressKind;
  title: string;
  steps: string[];
  activeIndex: number;
  percent: number;
  error?: string;
}

function ProgressDialog({ run }: { run: ProgressRun | null }) {
  if (!run) return null;
  return (
    <div className="progress-backdrop" role="status" aria-live="polite">
      <div className="progress-card">
        <div className="progress-title-row">
          <strong>{run.title}</strong>
          <span>{Math.max(0, Math.min(100, Math.round(run.percent)))}%</span>
        </div>
        <div className="progress-bar" aria-hidden="true">
          <span
            style={{ width: `${Math.max(0, Math.min(100, run.percent))}%` }}
          />
        </div>
        <ul className="progress-steps">
          {run.steps.map((step, index) => (
            <li
              key={`${run.kind}-${step}`}
              className={`${index < run.activeIndex ? "done" : ""}${index === run.activeIndex ? " active" : ""}${run.error && index === run.activeIndex ? " error" : ""}`.trim()}
            >
              <span className="step-dot" />
              <span>{step}</span>
            </li>
          ))}
        </ul>
        {run.error ? <div className="progress-error">{run.error}</div> : null}
      </div>
    </div>
  );
}

function progressPercent(stepIndex: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  return Math.round((stepIndex / stepCount) * 100);
}

function safeFileDisplayName(
  name: string | undefined,
  fallback = "file",
): string {
  const raw = typeof name === "string" ? name.trim() : "";
  if (!raw) return fallback;
  // Browsers normally expose File.name without a path. Keep this extra guard so
  // project files or non-standard drag/drop sources cannot persist local machine
  // path-like names in saved settings or UI labels.
  const leaf = raw.split(/[\\/]/).pop() || fallback;
  return leaf.replace(/^\.+/, "").trim() || fallback;
}

function safeOutputFileName(
  name: string | undefined,
  fallback: string,
): string {
  const leaf = safeFileDisplayName(name, fallback);
  return (
    leaf.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || fallback
  );
}

async function readFileHeaderText(file: File, maxBytes = 2048): Promise<string> {
  try {
    return await file.slice(0, maxBytes).text();
  } catch {
    return "";
  }
}

function isPrinterSpaceTextureBakingObjHeader(header: string): boolean {
  return (
    header.includes("# Color Mix Lab coordinate mode: keep") ||
    header.includes("Coordinates are rotated from Texture Baking Y-up to printer Z-up")
  );
}

async function clearBrowserRuntimeCaches(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => /^vc2cm|vertexcolor2colormix|vite/i.test(key))
          .map((key) => caches.delete(key)),
      );
    }
  } catch {
    // Cache API is optional and may be blocked by the browser/privacy settings.
  }

  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key && /^vc2cm|^vccm\./i.test(key))
        window.sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage can be unavailable in strict privacy modes.
  }
}

const MAX_WEBGL_PREVIEW_TRIANGLES = 2_000_000;
function fileSummary(file: File | null): string {
  if (!file) return "";
  const name = safeFileDisplayName(file.name);
  const sizeMb = file.size / (1024 * 1024);
  return sizeMb >= 1
    ? `${name} · ${sizeMb.toFixed(1)} MB`
    : `${name} · ${(file.size / 1024).toFixed(1)} KB`;
}

interface EmbeddedProjectFile {
  name: string;
  type?: string;
  size?: number;
  lastModified?: number;
  encoding: "base64";
  data: string;
}

const DEFAULT_PROJECT_PART_SELECTION: ProjectPartSelection = {
  settings: true,
  model: true,
  template: true,
  filamentList: true,
};

const CHROMIUM_PREVIEW_WARN_TRIANGLES = 2_000_000;
const CHROMIUM_PREVIEW_BLOCK_TRIANGLES = 3_000_000;

function detectBrowserFamily(): BrowserFamily {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Firefox\//i.test(ua)) return "firefox";
  if (/Edg\//i.test(ua)) return "edge";
  if (/Chrome\//i.test(ua) || /Chromium\//i.test(ua)) return "chrome";
  return "other";
}

function exportFileNameForModel(modelName: string): string {
  const base =
    safeOutputFileName(modelName || "model", "model").replace(/\.[^.]+$/, "") ||
    "model";
  return `${base}_colormix.3mf`;
}

function sourceBoundsForPreview(vertices: Vec3[]): {
  min: Vec3;
  max: Vec3;
  range: Vec3;
} {
  const min: Vec3 = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: Vec3 = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const v of vertices) {
    for (let i = 0; i < 3; i++) {
      if (v[i] < min[i]) min[i] = v[i];
      if (v[i] > max[i]) max[i] = v[i];
    }
  }
  return {
    min,
    max,
    range: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

function resolvePreviewCoordinateMode(
  mode: ExportCoordinateMode,
  vertices: Vec3[],
): Exclude<ExportCoordinateMode, "auto"> {
  if (mode !== "auto") return mode;
  const b = sourceBoundsForPreview(vertices);
  const [rx, ry, rz] = b.range;
  return ry > Math.max(rx, rz) * 1.1 ? "blender-y-up" : "keep";
}

function transformPreviewVertex(
  v: Vec3,
  mode: Exclude<ExportCoordinateMode, "auto">,
): Vec3 {
  if (mode === "keep") return v;
  const [x, y, z] = v;
  // Match the orientation PrusaSlicer applies to the generated 3MF transform.
  // The exporter and preview must use the same interpretation so view presets
  // stay aligned with the opened 3MF project.
  return [x, -z, y];
}

function orientedPreviewModel(
  model: MeshModel,
  coordinateMode: ExportCoordinateMode,
): MeshModel {
  const mode = resolvePreviewCoordinateMode(coordinateMode, model.vertices);
  if (mode === "keep") return model;
  const vertices: Vec3[] = model.vertices.map((v) =>
    transformPreviewVertex(v, mode),
  );
  return { ...model, vertices };
}

function triangleAreaWeightsForModel(model: MeshModel): number[] {
  const weights = new Array<number>(model.triangles.length);
  for (let i = 0; i < model.triangles.length; i++) {
    const tri = model.triangles[i];
    const a = model.vertices[tri[0]];
    const b = model.vertices[tri[1]];
    const c = model.vertices[tri[2]];
    if (!a || !b || !c) {
      weights[i] = 1;
      continue;
    }

    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    const area = 0.5 * Math.hypot(cx, cy, cz);
    weights[i] = Number.isFinite(area) && area > 0 ? area : 1;
  }
  return weights;
}

function getSystemTheme(): ResolvedPreviewBackground {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isPreviewBackground(value: unknown): value is PreviewBackground {
  return value === "auto" || value === "light" || value === "dark";
}

function isPreviewMode(value: unknown): value is PreviewMode {
  return value === "adjusted" || value === "quantized" || value === "print";
}

function isPreviewDisplayMode(value: unknown): value is PreviewDisplayMode {
  return value === "shaded" || value === "flat";
}

function isWebglLodMode(value: unknown): value is WebglLodMode {
  return (
    value === "off" ||
    value === "tiny" ||
    value === "small" ||
    value === "medium"
  );
}

function isPhysicalColourSource(value: unknown): value is PhysicalColourSource {
  return (
    value === "preset" ||
    value === "template" ||
    value === "manual" ||
    value === "suggestion"
  );
}

function isSuggestionMode(value: unknown): value is SuggestionMode {
  return (
    value === "balanced" ||
    value === "dominant" ||
    value === "wide" ||
    value === "expert"
  );
}

function isAccentProtectionMode(value: unknown): value is AccentProtectionMode {
  return value === "off" || value === "balanced" || value === "strong";
}

function isVirtualMixPriorityMode(
  value: unknown,
): value is VirtualMixPriorityMode {
  return (
    value === "accurate" || value === "preserve-hue" || value === "avoid-muddy"
  );
}

function isMappingStrategyMode(value: unknown): value is MappingStrategyMode {
  return (
    value === "closest" ||
    value === "smooth" ||
    value === "preserve-hue" ||
    value === "preserve-accent"
  );
}

function normalizeVirtualPreviewLightness(
  value: unknown,
  fallback = 0,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-90, Math.min(30, Math.round(n)));
}

function isVirtualPlanFilter(value: unknown): value is VirtualPlanFilter {
  return (
    value === "all" ||
    value === "virtual" ||
    value === "physical" ||
    value === "merged"
  );
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function projectFileBaseName(modelName: string | undefined): string {
  const base =
    safeOutputFileName(
      modelName || "vertexcolor2colormix",
      "vertexcolor2colormix",
    ).replace(/\.[^.]+$/, "") || "vertexcolor2colormix";
  return `${base}_project.json`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const clean = base64.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function fileToEmbeddedProjectFile(
  file: File,
  fallbackType: string,
): Promise<EmbeddedProjectFile> {
  const buffer = await file.arrayBuffer();
  return {
    name: safeFileDisplayName(file.name),
    type: file.type || fallbackType,
    size: file.size,
    lastModified: file.lastModified,
    encoding: "base64",
    data: arrayBufferToBase64(buffer),
  };
}

function embeddedProjectFileToFile(
  value: unknown,
  fallbackName: string,
  fallbackType: string,
): File | null {
  const r = recordOrNull(value);
  if (!r || r.encoding !== "base64" || typeof r.data !== "string") return null;
  const name = safeFileDisplayName(
    typeof r.name === "string" ? r.name : undefined,
    fallbackName,
  );
  const type =
    typeof r.type === "string" && r.type.trim() ? r.type : fallbackType;
  const lastModified =
    typeof r.lastModified === "number" && Number.isFinite(r.lastModified)
      ? r.lastModified
      : Date.now();
  return new File([base64ToArrayBuffer(r.data)], name, { type, lastModified });
}

function restoreColourAdjustments(
  value: unknown,
  fallback: ColourAdjustments,
): ColourAdjustments {
  const r = recordOrNull(value);
  if (!r) return fallback;
  return {
    brightness: numberSetting(r.brightness, fallback.brightness),
    contrast: numberSetting(r.contrast, fallback.contrast),
    saturation: numberSetting(r.saturation, fallback.saturation),
    temperature: numberSetting(r.temperature, fallback.temperature),
    hue: numberSetting(r.hue, fallback.hue),
    tint: numberSetting(r.tint, fallback.tint),
    gamma: numberSetting(r.gamma, fallback.gamma),
  };
}

function restoreSuggestionExpertSettings(
  value: unknown,
  fallback: SuggestionExpertSettings,
): SuggestionExpertSettings {
  const r = recordOrNull(value);
  if (!r) return fallback;
  const maxComponents = numberSetting(r.maxComponents, fallback.maxComponents);
  return {
    saturationPenalty: numberSetting(
      r.saturationPenalty,
      fallback.saturationPenalty,
    ),
    diversityPenalty: numberSetting(
      r.diversityPenalty,
      fallback.diversityPenalty,
    ),
    balance: numberSetting(r.balance, fallback.balance),
    weightExponent: numberSetting(r.weightExponent, fallback.weightExponent),
    neutralWeight: numberSetting(r.neutralWeight, fallback.neutralWeight),
    maxComponents:
      maxComponents === 1 || maxComponents === 2 ? maxComponents : 3,
  };
}

const SETTINGS_FILE_VERSION = "0.5.11";

function formatInt(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "0";
}

interface SuggestionExpertSettings {
  saturationPenalty: number;
  diversityPenalty: number;
  balance: number;
  weightExponent: number;
  neutralWeight: number;
  maxComponents: 1 | 2 | 3;
}

const DEFAULT_SUGGESTION_EXPERT_SETTINGS: SuggestionExpertSettings = {
  saturationPenalty: 0.3,
  diversityPenalty: 0.25,
  balance: 0.4,
  weightExponent: 0.4,
  neutralWeight: 0.5,
  maxComponents: 3,
};

function sameSuggestionExpertSettings(
  a: SuggestionExpertSettings,
  b: SuggestionExpertSettings,
): boolean {
  return (
    a.saturationPenalty === b.saturationPenalty &&
    a.diversityPenalty === b.diversityPenalty &&
    a.balance === b.balance &&
    a.weightExponent === b.weightExponent &&
    a.neutralWeight === b.neutralWeight &&
    a.maxComponents === b.maxComponents
  );
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function HelpLabel({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span className="help-label" title={title} aria-label={title}>
      {children}
    </span>
  );
}

function SliderRow({
  label,
  tooltip,
  value,
  min,
  max,
  step,
  onChange,
  gradient,
  disabled = false,
}: {
  label: string;
  tooltip: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  gradient?: "hue" | "tint";
  disabled?: boolean;
}) {
  return (
    <label
      className={`slider-row${gradient ? " with-gradient" : ""}${disabled ? " disabled" : ""}`}
    >
      <HelpLabel title={tooltip}>{label}</HelpLabel>
      <span className="slider-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
        />
        {gradient && (
          <span
            className={`slider-track-guide ${gradient}`}
            aria-hidden="true"
          />
        )}
      </span>
      <input
        className="number"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      />
    </label>
  );
}

function Swatch({ rgb, title }: { rgb: RGB; title?: string }) {
  return (
    <span
      className="swatch"
      title={title || rgbToHex(rgb)}
      style={{ backgroundColor: rgbToHex(rgb) }}
    />
  );
}

interface PaletteBlockEntry {
  key: string;
  rgb: RGB;
  count: number;
  label: string;
  title: string;
  selected?: boolean;
}

function PaletteBlockMap({
  entries,
  onToggle,
  emptyLabel,
}: {
  entries: PaletteBlockEntry[];
  onToggle?: (key: string) => void;
  emptyLabel: string;
}) {
  const total = entries.reduce(
    (sum, entry) => sum + Math.max(0, entry.count),
    0,
  );
  if (entries.length === 0 || total <= 0)
    return <p className="muted">{emptyLabel}</p>;

  return (
    <div className="colour-blockmap" role="list">
      {entries.map((entry) => {
        const share = total > 0 ? entry.count / total : 0;
        const basis = Math.max(34, Math.min(180, 34 + share * 620));
        const grow = Math.max(1, Math.min(10, share * 90));
        const textColour = readableTextColour(entry.rgb);
        return (
          <button
            type="button"
            key={entry.key}
            className={`colour-block${entry.selected ? " selected" : ""}${onToggle ? " clickable" : ""}`}
            style={{
              backgroundColor: rgbToHex(entry.rgb),
              color: textColour,
              flexBasis: `${basis}px`,
              flexGrow: grow,
            }}
            title={entry.title}
            onClick={() => onToggle?.(entry.key)}
            disabled={!onToggle}
          >
            <span>{entry.label}</span>
            <small>
              {share >= 0.01 ? `${Math.round(share * 100)}%` : "<1%"}
            </small>
          </button>
        );
      })}
    </div>
  );
}

function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function readableTextColour(rgb: RGB): string {
  return relativeLuminance(rgb) > 0.55 ? "#0b1118" : "#ffffff";
}

function ExtruderBadge({
  extruder,
  rgb,
  title,
}: {
  extruder: number;
  rgb?: RGB;
  title?: string;
}) {
  const colour = rgb ?? ([95, 105, 118] as RGB);
  const luminance = relativeLuminance(colour);
  return (
    <span
      className="extruder-badge"
      title={title || `E${extruder}: ${rgb ? rgbToHex(rgb) : ""}`}
      style={{
        backgroundColor: rgbToHex(colour),
        color: readableTextColour(colour),
        ["--badge-border" as string]:
          luminance < 0.08
            ? "rgba(255, 255, 255, 0.62)"
            : luminance > 0.78
              ? "rgba(0, 0, 0, 0.34)"
              : "rgba(255, 255, 255, 0.24)",
      }}
    >
      E{extruder}
    </span>
  );
}

function VirtualComponentSummary({ entry }: { entry: VirtualBlendEntry }) {
  return (
    <span
      className="virtual-plan-components"
      title={virtualSequenceTitle(entry)}
    >
      {entry.components.map((component, index) => (
        <React.Fragment key={`${entry.virtualId}-${component.extruder}`}>
          {index > 0 && <span className="component-plus">+</span>}
          <span className="component-piece">
            <ExtruderBadge extruder={component.extruder} rgb={component.rgb} />
            <span>
              {componentPercent(component.count, entry.sequence.length)}
            </span>
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

const PRUSA_LAYER_SEQUENCE_MIN_CELLS = 32;

function VirtualSequenceBar({
  sequence,
  slotRgbByNumber,
  title,
}: {
  sequence: number[];
  slotRgbByNumber: Map<number, RGB>;
  title: string;
}) {
  const cellCount =
    sequence.length > 0
      ? Math.max(PRUSA_LAYER_SEQUENCE_MIN_CELLS, sequence.length)
      : 0;
  const repeatedSequence = Array.from(
    { length: cellCount },
    (_, index) => sequence[index % sequence.length],
  );

  return (
    <span className="virtual-sequence-bar" title={title} aria-label={title}>
      {repeatedSequence.map((extruder, index) => {
        const rgb = slotRgbByNumber.get(extruder) ?? ([95, 105, 118] as RGB);
        return (
          <span
            key={`${extruder}-${index}`}
            className="virtual-sequence-step"
            title={`E${extruder}: ${rgbToHex(rgb)}`}
            style={{ backgroundColor: rgbToHex(rgb) }}
          />
        );
      })}
    </span>
  );
}

function FileInputButton({
  label,
  accept,
  onFile,
  disabled,
}: {
  label: string;
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`file-button${disabled ? " disabled" : ""}`}>
      {label}
      <input
        disabled={disabled}
        type="file"
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function slotSourceLabel(
  source: PhysicalColourSource,
  t: Record<string, string>,
): string {
  if (source === "preset") return t.sourcePreset;
  if (source === "template") return t.sourceTemplate;
  if (source === "manual") return t.sourceManual;
  return t.sourceSuggestion;
}

const STANDARD_PRESET_NAMES = [
  "CMYWK",
  "BRYWK",
  "CMYW",
  "BRYW",
  "CMW",
  "BRY",
  "5G",
  "4G",
  "3G",
];
const EXTENDED_PRESET_BASES = ["CMYWK", "BRYWK"];
type PresetExtensionGroup = "gamut" | "tone";
interface PresetExtensionChoice {
  group: PresetExtensionGroup;
  presetName: string;
}

const EXTENDED_PRESET_CHOICES: Record<
  string,
  Record<number, PresetExtensionChoice[]>
> = {
  CMYWK: {
    6: [
      { group: "gamut", presetName: "CMYWK+R" },
      { group: "tone", presetName: "CMYWK+Grey" },
    ],
    7: [
      { group: "gamut", presetName: "CMYWK+RG" },
      { group: "tone", presetName: "CMYWK+LightGrey+DarkGrey" },
    ],
    8: [
      { group: "gamut", presetName: "CMYWK+RGB" },
      { group: "tone", presetName: "CMYWK+LightGrey+Grey+DarkGrey" },
    ],
  },
  BRYWK: {
    6: [
      { group: "gamut", presetName: "BRYWK+G" },
      { group: "tone", presetName: "BRYWK+Grey" },
    ],
    7: [
      { group: "gamut", presetName: "BRYWK+GC" },
      { group: "tone", presetName: "BRYWK+LightGrey+DarkGrey" },
    ],
    8: [
      { group: "gamut", presetName: "BRYWK+GCM" },
      { group: "tone", presetName: "BRYWK+LightGrey+Grey+DarkGrey" },
    ],
  },
};

function presetExtensionGroupLabel(
  group: PresetExtensionGroup,
  t: Record<string, string>,
): string {
  if (group === "gamut") return t.presetGroupGamut;
  return t.presetGroupTone;
}

function presetColourTokenLabel(
  token: string,
  t: Record<string, string>,
): string {
  if (token === "Cyan") return t.colourCyan || "Cyan";
  if (token === "Magenta") return t.colourMagenta || "Magenta";
  if (token === "Yellow") return t.colourYellow || "Yellow";
  if (token === "White") return t.colourWhite || "White";
  if (token === "Black") return t.colourBlack || "Black";
  if (token === "Red") return t.colourRed || "Red";
  if (token === "Green") return t.colourGreen || "Green";
  if (token === "Blue") return t.colourBlue || "Blue";
  if (token === "Light Grey") return t.colourLightGrey || "Light Grey";
  if (token === "Grey") return t.colourGrey || "Grey";
  if (token === "Dark Grey") return t.colourDarkGrey || "Dark Grey";
  return token;
}

function basePresetName(name: string): string | null {
  for (const base of ["CMYWK", "BRYWK", "CMYW", "BRYW", "CMW", "BRY"]) {
    if (name === base || name.startsWith(`${base}+`)) return base;
  }
  return null;
}

function presetBaseChoices(count: number): string[] {
  if (count > 5) return EXTENDED_PRESET_BASES;
  // For 3-5 physical extruders, only show presets that exactly match
  // the selected slot count. Larger presets must not be silently truncated.
  return STANDARD_PRESET_NAMES.filter(
    (name) => presetSlotCount(name) === count,
  );
}

function presetBaseForSelection(name: string, count: number): string {
  const base = basePresetName(name) || name;
  if (count > 5) return EXTENDED_PRESET_BASES.includes(base) ? base : "CMYWK";
  return STANDARD_PRESET_NAMES.includes(name) ? name : base;
}

function presetExtensionChoices(
  base: string,
  count: number,
): PresetExtensionChoice[] {
  if (count <= 5) return [];
  return EXTENDED_PRESET_CHOICES[base]?.[count] ?? [];
}

function presetExtensionGroupForPresetName(
  name: string,
): PresetExtensionGroup | null {
  for (const baseChoices of Object.values(EXTENDED_PRESET_CHOICES)) {
    for (const countChoices of Object.values(baseChoices)) {
      const match = countChoices.find((choice) => choice.presetName === name);
      if (match) return match.group;
    }
  }
  return null;
}

function presetNameForExtensionStrategy(
  base: string,
  count: number,
  group: PresetExtensionGroup,
): string {
  const choices = presetExtensionChoices(base, count);
  return (
    choices.find((choice) => choice.group === group)?.presetName ??
    choices[0]?.presetName ??
    base
  );
}

function presetFullDescription(
  name: string,
  t: Record<string, string>,
): string {
  const colourNames = physicalColourPresetColourNames[name];
  if (!colourNames) return name;
  const translated = colourNames
    .map((token) => presetColourTokenLabel(token, t))
    .join(", ");
  return `${name}: ${translated}`;
}

function presetExtensionStrategies(
  choices: PresetExtensionChoice[],
): PresetExtensionGroup[] {
  return (["gamut", "tone"] as PresetExtensionGroup[]).filter((group) =>
    choices.some((choice) => choice.group === group),
  );
}

function filamentKey(filament: Filament): string {
  return `${filament.name}|${filament.type}|${rgbToHex(filament.effectiveRgb)}|${filament.sourceLine}`;
}

function slotKeysFromPhysicalSlots(
  physicalSlots: PhysicalSlot[],
  count: number,
): string[] {
  const bySlot = new Map(
    physicalSlots.map((slot) => [slot.slot, filamentKey(slot.filament)]),
  );
  return Array.from(
    { length: count },
    (_item, index) => bySlot.get(index + 1) || "",
  );
}

function normalizePhysicalSlotsForCount(
  physicalSlots: PhysicalSlot[],
  count: number,
): PhysicalSlot[] {
  return physicalSlots
    .filter((slot) => slot.slot >= 1 && slot.slot <= count)
    .sort((a, b) => a.slot - b.slot);
}

function serializableRgb(value: unknown): RGB | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const rgb = value
    .slice(0, 3)
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(Number(channel)))),
    ) as RGB;
  return rgb.every((channel) => Number.isFinite(channel)) ? rgb : null;
}

function serializeFilament(filament: Filament): Record<string, unknown> {
  return {
    name: filament.name,
    type: filament.type,
    rgb: filament.rgb,
    rgba: filament.rgba,
    effectiveRgb: filament.effectiveRgb,
    sourceLine: filament.sourceLine,
  };
}

function serializePhysicalSlot(slot: PhysicalSlot): Record<string, unknown> {
  return {
    slot: slot.slot,
    role: slot.role,
    filament: serializeFilament(slot.filament),
  };
}

function restoreFilament(value: unknown): Filament | null {
  const record = recordOrNull(value);
  if (!record) return null;
  const effectiveRgb =
    serializableRgb(record.effectiveRgb) ?? serializableRgb(record.rgb);
  const rgb = serializableRgb(record.rgb) ?? effectiveRgb;
  if (!rgb || !effectiveRgb) return null;
  const rgbaRaw = record.rgba;
  let rgba: Filament["rgba"] | undefined;
  if (Array.isArray(rgbaRaw) && rgbaRaw.length >= 4) {
    const parsed = rgbaRaw
      .slice(0, 4)
      .map((channel) =>
        Math.max(0, Math.min(255, Math.round(Number(channel)))),
      ) as [number, number, number, number];
    if (parsed.every((channel) => Number.isFinite(channel))) rgba = parsed;
  }
  return {
    name:
      typeof record.name === "string"
        ? safeFileDisplayName(record.name, "Filament")
        : `Filament ${rgbToHex(effectiveRgb)}`,
    type: typeof record.type === "string" ? record.type : "",
    rgb,
    rgba,
    effectiveRgb,
    sourceLine:
      typeof record.sourceLine === "string"
        ? record.sourceLine
        : `${rgbToHex(effectiveRgb)}`,
  };
}

function restorePhysicalSlots(value: unknown, count: number): PhysicalSlot[] {
  if (!Array.isArray(value)) return [];
  const slots: PhysicalSlot[] = [];
  const usedSlots = new Set<number>();
  for (const item of value) {
    const record = recordOrNull(item);
    if (!record) continue;
    const slot = Math.round(Number(record.slot));
    if (
      !Number.isFinite(slot) ||
      slot < 1 ||
      slot > count ||
      usedSlots.has(slot)
    )
      continue;
    const filament = restoreFilament(record.filament);
    if (!filament) continue;
    slots.push({
      slot,
      filament,
      role: typeof record.role === "string" ? record.role : "suggested",
    });
    usedSlots.add(slot);
  }
  return normalizePhysicalSlotsForCount(slots, count);
}

function serializePaletteEntries(
  entries: PaletteEntry[],
): Array<Record<string, unknown>> {
  return entries.map((entry) => ({
    index: entry.index,
    rgb: entry.rgb,
    count: entry.count,
  }));
}

function restorePaletteEntries(value: unknown): PaletteEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: PaletteEntry[] = [];
  const used = new Set<number>();
  for (const item of value) {
    const record = recordOrNull(item);
    if (!record) continue;
    const index = Math.round(Number(record.index));
    const rgb = serializableRgb(record.rgb);
    const count = Math.max(0, Math.round(Number(record.count)));
    if (
      !Number.isFinite(index) ||
      index < 1 ||
      used.has(index) ||
      !rgb ||
      !Number.isFinite(count)
    )
      continue;
    entries.push({ index, rgb, count });
    used.add(index);
  }
  return entries.sort((a, b) => a.index - b.index);
}

function serializeAssignmentOverrides(
  overrides: Record<number, AssignmentOverride>,
): Record<string, AssignmentOverride> {
  const result: Record<string, AssignmentOverride> = {};
  for (const [key, override] of Object.entries(overrides)) {
    const index = Math.round(Number(key));
    if (!Number.isFinite(index) || index < 1) continue;
    if (override.kind === "physical") {
      const extruder = Math.max(1, Math.round(Number(override.extruder)));
      result[String(index)] = { kind: "physical", extruder };
    } else if (override.kind === "merge") {
      const targetPaletteIndex = Math.max(
        1,
        Math.round(Number(override.targetPaletteIndex)),
      );
      result[String(index)] = { kind: "merge", targetPaletteIndex };
    }
  }
  return result;
}

function restoreAssignmentOverrides(
  value: unknown,
  physicalExtruderCount: number,
): Record<number, AssignmentOverride> {
  const record = recordOrNull(value);
  if (!record) return {};
  const result: Record<number, AssignmentOverride> = {};
  for (const [rawKey, rawOverride] of Object.entries(record)) {
    const key = Math.round(Number(rawKey));
    const override = recordOrNull(rawOverride);
    if (!Number.isFinite(key) || key < 1 || !override) continue;
    if (override.kind === "physical") {
      const extruder = Math.max(
        1,
        Math.min(physicalExtruderCount, Math.round(Number(override.extruder))),
      );
      if (Number.isFinite(extruder))
        result[key] = { kind: "physical", extruder };
    } else if (override.kind === "merge") {
      const targetPaletteIndex = Math.max(
        1,
        Math.round(Number(override.targetPaletteIndex)),
      );
      if (Number.isFinite(targetPaletteIndex))
        result[key] = { kind: "merge", targetPaletteIndex };
    }
  }
  return result;
}

function filamentMaterialLabel(
  filament: Filament,
  t: Record<string, string>,
): string {
  const material = filament.type.trim();
  return material || t.materialUnknown;
}

function rgbSpectrumKey(rgb: RGB): [number, number, number, number, string] {
  const [r, g, b] = rgb.map((value) => value / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const saturationValue = max === 0 ? 0 : delta / max;
  const luminanceValue = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

  // Near-neutral colours such as white, grey, black and transparent/natural
  // filament tones should not appear between saturated blue and purple just
  // because their RGB channels contain a small residual hue.
  if (delta < 0.000001 || saturationValue < 0.08) {
    return [1, 0, 0, luminanceValue, rgbToHex(rgb)];
  }

  let hue = 0;
  if (max === r) {
    hue = 60 * (((g - b) / delta) % 6);
  } else if (max === g) {
    hue = 60 * ((b - r) / delta + 2);
  } else {
    hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;

  // Sort by visible spectrum starting at red. HSV values close to 360° are
  // still red, so they are wrapped before orange/yellow instead of being
  // placed after magenta.
  const spectrumHue = hue >= 345 ? hue - 360 : hue;
  return [0, spectrumHue, -saturationValue, luminanceValue, rgbToHex(rgb)];
}

function compareRgbBySpectrum(a: RGB, b: RGB): number {
  const ak = rgbSpectrumKey(a);
  const bk = rgbSpectrumKey(b);
  return (
    ak[0] - bk[0] ||
    ak[1] - bk[1] ||
    ak[2] - bk[2] ||
    ak[3] - bk[3] ||
    compareText(ak[4], bk[4])
  );
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

const BLEND_STEP_OPTIONS = [5, 10, 20, 25] as const;
type BlendStepPercent = (typeof BLEND_STEP_OPTIONS)[number];

function normalizeBlendStepPercent(
  value: number,
  fallback: BlendStepPercent = 5,
): BlendStepPercent {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value * 10) / 10;
  return BLEND_STEP_OPTIONS.includes(rounded as BlendStepPercent)
    ? (rounded as BlendStepPercent)
    : fallback;
}

function blendRecipeResolutionLabel(step: BlendStepPercent): string {
  return `${step}% + thirds`;
}

function suggestionOptions(
  mode: SuggestionMode,
  expert: SuggestionExpertSettings,
  ratioStepPercent: number,
) {
  const base =
    mode === "expert"
      ? expert
      : mode === "dominant"
        ? {
            saturationPenalty: 0.2,
            diversityPenalty: 0.1,
            balance: 0.0,
            weightExponent: 1.0,
            neutralWeight: 0.2,
            maxComponents: 3 as const,
          }
        : mode === "wide"
          ? {
              saturationPenalty: 0.2,
              diversityPenalty: 0.45,
              balance: 0.7,
              weightExponent: 0.3,
              neutralWeight: 0.4,
              maxComponents: 3 as const,
            }
          : {
              saturationPenalty: 0.3,
              diversityPenalty: 0.25,
              balance: 0.4,
              weightExponent: 0.4,
              neutralWeight: 0.5,
              maxComponents: 3 as const,
            };
  return { ...base, ratioStepPercent };
}

function isGreyscalePreset(name: string): boolean {
  return name === "5G" || name === "4G" || name === "3G";
}

function greyscaleAdjustmentsFrom(base: ColourAdjustments): ColourAdjustments {
  return {
    ...base,
    saturation: -100,
    temperature: 0,
    hue: 0,
    tint: 0,
  };
}

function componentPercent(count: number, sequenceLength: number): string {
  if (sequenceLength <= 0) return "0%";
  if (sequenceLength === 3 && count === 1) return "33%";
  const pct = (count / sequenceLength) * 100;
  const roundedToFive = Math.round(pct / 5) * 5;
  return `${Math.max(0, Math.min(100, roundedToFive))}%`;
}

function virtualComponentSummaryText(entry: VirtualBlendEntry): string {
  return entry.components
    .map(
      (c) =>
        `E${c.extruder} ${componentPercent(c.count, entry.sequence.length)}`,
    )
    .join(" + ");
}

function virtualSequenceTitle(entry: VirtualBlendEntry): string {
  return `${virtualComponentSummaryText(entry)}\n${entry.sequence.map((ext) => `E${ext}`).join(" ")}`;
}

function paletteMapByIndex(palette: PaletteEntry[]): Map<number, PaletteEntry> {
  return new Map(palette.map((entry) => [entry.index, entry]));
}

function simpleRgbDistance(a: RGB, b: RGB): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function applyAssignmentOverridesToPlan(
  basePlan: VirtualExtruderPlan,
  palette: PaletteEntry[],
  physicalSlots: PhysicalSlot[],
  overrides: Record<number, AssignmentOverride>,
): VirtualExtruderPlan {
  const paletteByIndex = paletteMapByIndex(palette);
  const baseVirtualById = new Map(
    basePlan.virtualBlends.map((entry) => [entry.virtualId, entry]),
  );
  const physicalRgbByExtruder = new Map(
    physicalSlots.map((slot) => [slot.slot, slot.filament.effectiveRgb]),
  );
  const basePhysicalByPaletteIndex = new Map<number, PhysicalOnlyEntry>();
  for (const entry of basePlan.physicalOnly) {
    for (const paletteIndex of entry.targetPaletteIndices)
      basePhysicalByPaletteIndex.set(paletteIndex, entry);
  }
  const paletteToAssignment = new Map<
    number,
    | { kind: "physical"; extruder: number }
    | { kind: "virtual"; virtualId: number }
  >();
  const virtualPaletteIndices = new Map<number, number[]>();
  const physicalPaletteIndices = new Map<number, number[]>();

  const baseAssignmentFor = (paletteIndex: number) =>
    basePlan.paletteToAssignment.get(paletteIndex) ?? null;

  const resolvedAssignmentFor = (
    paletteIndex: number,
  ):
    | { kind: "physical"; extruder: number }
    | { kind: "virtual"; virtualId: number }
    | null => {
    const override = overrides[paletteIndex];
    if (override?.kind === "physical")
      return { kind: "physical", extruder: override.extruder };
    if (override?.kind === "merge") {
      const targetOverride = overrides[override.targetPaletteIndex];
      if (targetOverride?.kind === "physical")
        return { kind: "physical", extruder: targetOverride.extruder };
      return (
        baseAssignmentFor(override.targetPaletteIndex) ??
        baseAssignmentFor(paletteIndex)
      );
    }
    return baseAssignmentFor(paletteIndex);
  };

  for (const entry of palette) {
    const assignment = resolvedAssignmentFor(entry.index);
    if (!assignment) continue;
    paletteToAssignment.set(entry.index, assignment);
    if (assignment.kind === "virtual") {
      const list = virtualPaletteIndices.get(assignment.virtualId) ?? [];
      list.push(entry.index);
      virtualPaletteIndices.set(assignment.virtualId, list);
    } else {
      const list = physicalPaletteIndices.get(assignment.extruder) ?? [];
      list.push(entry.index);
      physicalPaletteIndices.set(assignment.extruder, list);
    }
  }

  const virtualBlends: VirtualBlendEntry[] = [];
  for (const [virtualId, indices] of virtualPaletteIndices) {
    const template = baseVirtualById.get(virtualId);
    if (!template) continue;
    const sorted = [...indices].sort((a, b) => a - b);
    const triangleCount = sorted.reduce(
      (sum, index) => sum + (paletteByIndex.get(index)?.count ?? 0),
      0,
    );
    virtualBlends.push({
      ...template,
      targetPaletteIndices: sorted,
      triangleCount,
      // Keep the preview colour from the base plan. It already contains the
      // selected FDM mixer prediction and virtual preview brightness calibration.
      displayRgb: template.displayRgb,
    });
  }
  virtualBlends.sort((a, b) => a.virtualId - b.virtualId);

  const physicalOnly = [...physicalPaletteIndices.entries()]
    .map(([extruder, indices]) => {
      const sorted = [...indices].sort((a, b) => a - b);
      const rawPhysicalRgb =
        physicalRgbByExtruder.get(extruder) ?? ([120, 120, 120] as RGB);
      const basePhysical = sorted
        .map((paletteIndex) => basePhysicalByPaletteIndex.get(paletteIndex))
        .find((entry) => entry?.physicalExtruder === extruder);
      const physicalRgb = basePhysical?.physicalRgb ?? rawPhysicalRgb;
      const triangleCount = sorted.reduce(
        (sum, paletteIndex) =>
          sum + (paletteByIndex.get(paletteIndex)?.count ?? 0),
        0,
      );
      const linearRgbError = sorted.reduce((maxError, paletteIndex) => {
        const p = paletteByIndex.get(paletteIndex);
        return Math.max(
          maxError,
          p ? simpleRgbDistance(p.rgb, rawPhysicalRgb) : 0,
        );
      }, 0);
      const firstPalette = paletteByIndex.get(sorted[0] ?? -1);
      return {
        paletteIndex: sorted[0] ?? extruder,
        targetPaletteIndices: sorted,
        targetRgb: firstPalette?.rgb ?? physicalRgb,
        physicalRgb,
        physicalExtruder: extruder,
        triangleCount,
        linearRgbError,
      };
    })
    .sort((a, b) => a.paletteIndex - b.paletteIndex);

  return {
    virtualBlends,
    physicalOnly,
    paletteToAssignment,
    mappingDiagnostics: basePlan.mappingDiagnostics,
  };
}

function paletteIndexTitle(indices: number[]): string {
  return indices.map((index) => `#${index}`).join(" ");
}

function paletteIndexPreview(indices: number[], maxItems = 8): string {
  if (indices.length <= maxItems) return paletteIndexTitle(indices);
  return `${indices
    .slice(0, maxItems)
    .map((index) => `#${index}`)
    .join(" ")} ...`;
}

function isDefaultAdjustments(adj: ColourAdjustments): boolean {
  return (
    adj.brightness === defaultAdjustments.brightness &&
    adj.contrast === defaultAdjustments.contrast &&
    adj.saturation === defaultAdjustments.saturation &&
    adj.temperature === defaultAdjustments.temperature &&
    adj.hue === defaultAdjustments.hue &&
    adj.tint === defaultAdjustments.tint &&
    adj.gamma === defaultAdjustments.gamma
  );
}

interface VertexColorMixAppProps {
  incomingObjFile?: File | null;
  incomingObjNonce?: number;
  focusLoadTabNonce?: number;
  onIncomingObjConsumed?: () => void;
  shellTheme?: ResolvedPreviewBackground;
  hideTopbarControls?: boolean;
  reloadDataNonce?: number;
  onStatusChange?: (message: string) => void;
}

export default function App({
  incomingObjFile = null,
  incomingObjNonce = 0,
  focusLoadTabNonce = 0,
  onIncomingObjConsumed,
  onStatusChange,
  shellTheme,
  hideTopbarControls = false,
  reloadDataNonce = 0,
}: VertexColorMixAppProps = {}) {
  const [lang, setLang] = useState<Lang>("en");
  const t = useMemo(() => getDict(lang), [lang]);
  const [activeTab, setActiveTab] = useState<SidebarTab>("model");

  useEffect(() => {
    if (focusLoadTabNonce > 0) setActiveTab("model");
  }, [focusLoadTabNonce]);

  const browserFamily = useMemo(() => detectBrowserFamily(), []);
  const [threePreviewRequested, setThreePreviewRequested] = useState(false);
  const [forceThreePreview, setForceThreePreview] = useState(false);

  const [model, setModel] = useState<MeshModel | null>(null);
  const [fineRotationAxis, setFineRotationAxis] =
    useState<ModelRotationAxis>("z");
  const [fineRotationAngle, setFineRotationAngle] = useState(0);
  const [largeModelComputationsDeferred, setLargeModelComputationsDeferred] =
    useState(false);
  const statusRef = useRef(t.statusReady);
  const setStatus = useCallback(
    (nextStatus: React.SetStateAction<string>) => {
      const resolvedStatus =
        typeof nextStatus === "function"
          ? nextStatus(statusRef.current)
          : nextStatus;
      statusRef.current = resolvedStatus;
      onStatusChange?.(resolvedStatus);
    },
    [onStatusChange],
  );
  const [fileLoadBusy, setFileLoadBusy] = useState(false);
  const [pendingObjFile, setPendingObjFile] = useState<File | null>(null);
  const [pendingTemplateFile, setPendingTemplateFile] = useState<File | null>(
    null,
  );
  const [pendingFilamentListFile, setPendingFilamentListFile] =
    useState<File | null>(null);
  const [filePickerResetKey, setFilePickerResetKey] = useState(0);
  const [progressRun, setProgressRun] = useState<ProgressRun | null>(null);

  const [pendingMaxColours, setPendingMaxColours] = useState(128);
  const [appliedMaxColours, setAppliedMaxColours] = useState(128);
  const [pendingBlendStepPercent, setPendingBlendStepPercent] =
    useState<BlendStepPercent>(5);
  const [appliedBlendStepPercent, setAppliedBlendStepPercent] =
    useState<BlendStepPercent>(5);
  const [pendingAccentProtection, setPendingAccentProtection] =
    useState<AccentProtectionMode>("off");
  const [appliedAccentProtection, setAppliedAccentProtection] =
    useState<AccentProtectionMode>("off");
  const [pendingVirtualMixPriority, setPendingVirtualMixPriority] =
    useState<VirtualMixPriorityMode>("accurate");
  const [appliedVirtualMixPriority, setAppliedVirtualMixPriority] =
    useState<VirtualMixPriorityMode>("accurate");
  const [pendingMappingStrategy, setPendingMappingStrategy] =
    useState<MappingStrategyMode>("closest");
  const [appliedMappingStrategy, setAppliedMappingStrategy] =
    useState<MappingStrategyMode>("closest");
  const [pendingVirtualPreviewLightness, setPendingVirtualPreviewLightness] =
    useState(0);
  const [appliedVirtualPreviewLightness, setAppliedVirtualPreviewLightness] =
    useState(0);
  const [paletteApplyBusy, setPaletteApplyBusy] = useState(false);
  const [virtualEditBusy, setVirtualEditBusy] = useState(false);
  const [pendingAdjustments, setPendingAdjustments] =
    useState<ColourAdjustments>(defaultAdjustments);
  const [appliedAdjustments, setAppliedAdjustments] =
    useState<ColourAdjustments>(defaultAdjustments);
  const [colourApplyBusy, setColourApplyBusy] = useState(false);
  const [palette, setPalette] = useState<PaletteEntry[]>([]);

  const [view, setView] = useState<View>("front");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("quantized");
  const [previewBackground, setPreviewBackground] =
    useState<PreviewBackground>("auto");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const stored = window.localStorage.getItem("vc2cm-theme-mode");
    return isThemeMode(stored) ? stored : "system";
  });
  const [systemTheme, setSystemTheme] = useState<ResolvedPreviewBackground>(
    () => getSystemTheme(),
  );
  const [previewDisplayMode, setPreviewDisplayMode] =
    useState<PreviewDisplayMode>("flat");
  const [wireframe, setWireframe] = useState(false);
  const [showAxes, setShowAxes] = useState(false);
  const [webglLodMode, setWebglLodMode] = useState<WebglLodMode>("off");
  const [previewResetKey, setPreviewResetKey] = useState(0);
  const [previewBusy, setPreviewBusy] = useState(false);

  const [physicalExtruders, setPhysicalExtruders] = useState(5);
  const [physicalColourSource, setPhysicalColourSource] =
    useState<PhysicalColourSource>("preset");
  const [presetName, setPresetName] = useState("CMYWK");
  const [manualPhysicalColours, setManualPhysicalColours] = useState(
    "#00FFFF\n#FF00FF\n#FFFF00\n#FFFFFF\n#000000",
  );
  const [pendingPhysicalExtruders, setPendingPhysicalExtruders] = useState(5);
  const [pendingPhysicalColourSource, setPendingPhysicalColourSource] =
    useState<PhysicalColourSource>("preset");
  const [pendingPresetName, setPendingPresetName] = useState("CMYWK");
  const [pendingManualPhysicalColours, setPendingManualPhysicalColours] =
    useState("#00FFFF\n#FF00FF\n#FFFF00\n#FFFFFF\n#000000");

  const [templateInfo, setTemplateInfo] = useState<Template3mfInfo | null>(
    null,
  );
  const [templateArrayBuffer, setTemplateArrayBuffer] =
    useState<ArrayBuffer | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);

  const [loadedFilaments, setLoadedFilaments] = useState<Filament[]>([]);
  const [filamentListName, setFilamentListName] = useState("");
  const [filamentBusy, setFilamentBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [saveProjectParts, setSaveProjectParts] =
    useState<ProjectPartSelection>(DEFAULT_PROJECT_PART_SELECTION);
  const [loadProjectParts, setLoadProjectParts] =
    useState<ProjectPartSelection>(DEFAULT_PROJECT_PART_SELECTION);
  const [exportBusy, setExportBusy] = useState(false);
  const [orientationBusy, setOrientationBusy] = useState(false);
  const [exportFileName, setExportFileName] = useState("");
  const [exportCoordinateMode, setExportCoordinateMode] =
    useState<ExportCoordinateMode>("auto");
  const [exportScale, setExportScale] = useState("1");
  const [exportTargetHeight, setExportTargetHeight] = useState("");
  const [exportPutOnBed, setExportPutOnBed] = useState(true);
  const [exportCenterOnBed, setExportCenterOnBed] = useState(true);
  const [exportBedSource, setExportBedSource] =
    useState<ExportBedSource>("template");
  const [exportBedX, setExportBedX] = useState("250");
  const [exportBedY, setExportBedY] = useState("210");
  const [exportDefaultExtruder, setExportDefaultExtruder] = useState(1);
  const [suggestionMode, setSuggestionMode] =
    useState<SuggestionMode>("balanced");
  const [appliedSuggestionMode, setAppliedSuggestionMode] =
    useState<SuggestionMode>("balanced");
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [filamentMaterialFilter, setFilamentMaterialFilter] =
    useState("__all__");
  const [appliedFilamentMaterialFilter, setAppliedFilamentMaterialFilter] =
    useState("__all__");
  const [filamentSortKey, setFilamentSortKey] =
    useState<FilamentSortKey>("name");
  const [filamentSortDirection, setFilamentSortDirection] =
    useState<SortDirection>("asc");
  const [manualFilamentSelectionKeys, setManualFilamentSelectionKeys] =
    useState<string[]>([]);
  const [activeManualSlotIndex, setActiveManualSlotIndex] = useState(0);
  const [filamentSlotMode, setFilamentSlotMode] =
    useState<FilamentSlotMode>("suggested");
  const [virtualPlanFilter, setVirtualPlanFilter] =
    useState<VirtualPlanFilter>("all");
  const [assignmentOverrides, setAssignmentOverrides] = useState<
    Record<number, AssignmentOverride>
  >({});
  const [selectedAssignmentKeys, setSelectedAssignmentKeys] = useState<
    string[]
  >([]);
  const [assignmentTargetExtruder, setAssignmentTargetExtruder] = useState(1);
  const [suggestionExpertSettings, setSuggestionExpertSettings] =
    useState<SuggestionExpertSettings>(DEFAULT_SUGGESTION_EXPERT_SETTINGS);
  const [appliedSuggestionExpertSettings, setAppliedSuggestionExpertSettings] =
    useState<SuggestionExpertSettings>(DEFAULT_SUGGESTION_EXPERT_SETTINGS);
  const [slots, setSlots] = useState<PhysicalSlot[]>([]);
  const filamentSuggestionEnabled = physicalColourSource === "suggestion";
  const pendingGreyscalePresetActive =
    pendingPhysicalColourSource === "preset" &&
    isGreyscalePreset(pendingPresetName);
  const pendingPresetBaseName = useMemo(
    () => presetBaseForSelection(pendingPresetName, pendingPhysicalExtruders),
    [pendingPhysicalExtruders, pendingPresetName],
  );
  const pendingPresetBaseChoices = useMemo(
    () => presetBaseChoices(pendingPhysicalExtruders),
    [pendingPhysicalExtruders],
  );
  const pendingPresetExtensionChoices = useMemo(
    () =>
      presetExtensionChoices(pendingPresetBaseName, pendingPhysicalExtruders),
    [pendingPhysicalExtruders, pendingPresetBaseName],
  );
  const pendingPresetExtensionStrategies = useMemo(
    () => presetExtensionStrategies(pendingPresetExtensionChoices),
    [pendingPresetExtensionChoices],
  );
  const pendingPresetExtensionStrategy = useMemo(
    () =>
      presetExtensionGroupForPresetName(pendingPresetName) ??
      pendingPresetExtensionStrategies[0] ??
      "gamut",
    [pendingPresetExtensionStrategies, pendingPresetName],
  );
  const pendingPresetTooSmall =
    pendingPhysicalColourSource === "preset" &&
    presetSlotCount(pendingPresetName) < pendingPhysicalExtruders;
  const pendingPresetDescription = useMemo(
    () => presetFullDescription(pendingPresetName, t),
    [pendingPresetName, t],
  );
  const physicalSettingsDirty =
    pendingPhysicalExtruders !== physicalExtruders ||
    pendingPhysicalColourSource !== physicalColourSource ||
    pendingPresetName !== presetName ||
    pendingManualPhysicalColours !== manualPhysicalColours;
  const greyscalePresetActive =
    physicalColourSource === "preset" && isGreyscalePreset(presetName);

  const filamentMaterials = useMemo(() => {
    const materials = new Set<string>();
    for (const filament of loadedFilaments) {
      const material = filament.type.trim();
      materials.add(material || "__unknown__");
    }
    return Array.from(materials).sort((a, b) =>
      a === "__unknown__" ? 1 : b === "__unknown__" ? -1 : compareText(a, b),
    );
  }, [loadedFilaments]);

  const filteredFilaments = useMemo(() => {
    if (filamentMaterialFilter === "__all__") return loadedFilaments;
    return loadedFilaments.filter((filament) => {
      const material = filament.type.trim() || "__unknown__";
      return material === filamentMaterialFilter;
    });
  }, [filamentMaterialFilter, loadedFilaments]);

  const sortedFilteredFilaments = useMemo(() => {
    const direction = filamentSortDirection === "asc" ? 1 : -1;
    return [...filteredFilaments].sort((a, b) => {
      let result = 0;
      if (filamentSortKey === "assign") {
        const aSlot = manualFilamentSelectionKeys.findIndex(
          (key) => key === filamentKey(a),
        );
        const bSlot = manualFilamentSelectionKeys.findIndex(
          (key) => key === filamentKey(b),
        );
        const aAssigned = aSlot >= 0;
        const bAssigned = bSlot >= 0;
        if (aAssigned && bAssigned) result = aSlot - bSlot;
        else if (aAssigned !== bAssigned) result = aAssigned ? -1 : 1;
        else
          result = compareText(a.name, b.name) || compareText(a.type, b.type);
      } else if (filamentSortKey === "material") {
        result =
          compareText(
            a.type || t.materialUnknown,
            b.type || t.materialUnknown,
          ) || compareText(a.name, b.name);
      } else if (filamentSortKey === "colour") {
        result =
          compareRgbBySpectrum(a.effectiveRgb, b.effectiveRgb) ||
          compareText(a.name, b.name);
      } else {
        result = compareText(a.name, b.name) || compareText(a.type, b.type);
      }
      return result * direction;
    });
  }, [
    filamentSortDirection,
    filamentSortKey,
    filteredFilaments,
    manualFilamentSelectionKeys,
    t.materialUnknown,
  ]);

  const filamentByKey = useMemo(
    () =>
      new Map(
        loadedFilaments.map((filament) => [filamentKey(filament), filament]),
      ),
    [loadedFilaments],
  );

  const draftFilamentSelectionKeys = useMemo(() => {
    return Array.from(
      { length: physicalExtruders },
      (_item, index) => manualFilamentSelectionKeys[index] || "",
    );
  }, [manualFilamentSelectionKeys, physicalExtruders]);

  const manualFilamentSlots = useMemo(() => {
    return draftFilamentSelectionKeys.map((key) =>
      key ? (filamentByKey.get(key) ?? null) : null,
    );
  }, [draftFilamentSelectionKeys, filamentByKey]);

  const manuallySelectedFilaments = useMemo(
    () =>
      manualFilamentSlots.filter((filament): filament is Filament =>
        Boolean(filament),
      ),
    [manualFilamentSlots],
  );

  const manualSelectionOutsideFilterCount = useMemo(() => {
    if (filamentMaterialFilter === "__all__") return 0;
    return manualFilamentSlots.filter((filament) => {
      if (!filament) return false;
      const material = filament.type.trim() || "__unknown__";
      return material !== filamentMaterialFilter;
    }).length;
  }, [filamentMaterialFilter, manualFilamentSlots]);

  const previewRef = useRef<ThreePreviewHandle | null>(null);
  const baseModelRef = useRef<MeshModel | null>(null);
  const orientationMatrixRef = useRef<OrientationMatrix>([
    ...IDENTITY_ORIENTATION_MATRIX,
  ]);
  const waitingForPreviewAfterApplyRef = useRef(false);
  const waitingForPreviewAfterPaletteApplyRef = useRef(false);
  const waitingForThreePreviewProgressRef = useRef(false);
  const previewProgressTimeoutRef = useRef<number | null>(null);
  const previewBusyRef = useRef(false);
  const exportFileNameUserEditedRef = useRef(false);
  const modelFileRef = useRef<File | null>(null);
  const templateFileRef = useRef<File | null>(null);
  const filamentListFileRef = useRef<File | null>(null);
  const colourApplyTimeoutRef = useRef<number | null>(null);
  const paletteApplyTimeoutRef = useRef<number | null>(null);
  const suggestionProgressTimeoutRef = useRef<number | null>(null);
  const suggestionRunIdRef = useRef(0);
  const greyscalePresetWasActiveRef = useRef(false);
  const adjustmentsBeforeGreyscalePresetRef = useRef<{
    pending: ColourAdjustments;
    applied: ColourAdjustments;
  } | null>(null);

  useEffect(() => {
    setStatus((prev) =>
      prev === "Ready." || prev === "Bereit." ? t.statusReady : prev,
    );
  }, [setStatus, t.statusReady]);

  useEffect(() => {
    if (pendingPhysicalColourSource !== "preset") return;
    if (pendingPhysicalExtruders > 5) {
      const base = presetBaseForSelection(
        pendingPresetName,
        pendingPhysicalExtruders,
      );
      const choices = presetExtensionChoices(base, pendingPhysicalExtruders);
      if (choices.length === 0) return;
      if (choices.some((choice) => choice.presetName === pendingPresetName))
        return;
      const preferredGroup =
        presetExtensionGroupForPresetName(pendingPresetName) ??
        choices[0].group;
      const nextPresetName =
        choices.find((choice) => choice.group === preferredGroup)?.presetName ??
        choices[0].presetName;
      setPendingPresetName(nextPresetName);
      return;
    }
    const choices = presetBaseChoices(pendingPhysicalExtruders);
    if (choices.length === 0) return;
    if (choices.includes(pendingPresetName)) return;
    setPendingPresetName(choices[0]);
  }, [
    pendingPhysicalColourSource,
    pendingPhysicalExtruders,
    pendingPresetName,
  ]);

  useEffect(() => {
    setManualFilamentSelectionKeys((prev) => {
      const next = Array.from(
        { length: physicalExtruders },
        (_, index) => prev[index] || "",
      );
      return next.length === prev.length &&
        next.every((item, index) => item === prev[index])
        ? prev
        : next;
    });
    setActiveManualSlotIndex((prev) =>
      Math.max(0, Math.min(prev, physicalExtruders - 1)),
    );
  }, [physicalExtruders]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(media.matches ? "dark" : "light");
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("vc2cm-theme-mode", themeMode);
    }
  }, [themeMode]);

  const resolvedTheme: ResolvedPreviewBackground =
    shellTheme ?? (themeMode === "system" ? systemTheme : themeMode);
  const resolvedPreviewBackground: ResolvedPreviewBackground =
    previewBackground === "auto" ? resolvedTheme : previewBackground;

  const chromiumLikeBrowser =
    browserFamily === "chrome" || browserFamily === "edge";
  const triangleCount = model?.stats.triangleCount ?? 0;
  const chromiumPreviewRisk = Boolean(
    model &&
    chromiumLikeBrowser &&
    triangleCount >= CHROMIUM_PREVIEW_WARN_TRIANGLES,
  );
  const chromiumPreviewBlocked = Boolean(
    model &&
    threePreviewRequested &&
    chromiumLikeBrowser &&
    triangleCount >= CHROMIUM_PREVIEW_BLOCK_TRIANGLES &&
    !forceThreePreview,
  );
  const threePreviewActive = Boolean(
    model &&
    threePreviewRequested &&
    !chromiumPreviewBlocked &&
    !largeModelComputationsDeferred,
  );
  const previewModel = useMemo(
    () => (model ? orientedPreviewModel(model, exportCoordinateMode) : null),
    [model, exportCoordinateMode],
  );
  const modelForComputedPreview = largeModelComputationsDeferred
    ? null
    : previewModel;

  const adjustedColors = useMemo(() => {
    if (!model || largeModelComputationsDeferred) return [];
    if (isDefaultAdjustments(appliedAdjustments)) return model.triangleColors;
    return model.triangleColors.map((c) => adjustColour(c, appliedAdjustments));
  }, [model, appliedAdjustments, largeModelComputationsDeferred]);

  const triangleAreaWeights = useMemo(() => {
    if (!model || largeModelComputationsDeferred) return [];
    return triangleAreaWeightsForModel(model);
  }, [model, largeModelComputationsDeferred]);

  function showProgress(
    kind: ProgressKind,
    title: string,
    steps: string[],
    activeIndex: number,
    error?: string,
  ): void {
    setProgressRun({
      kind,
      title,
      steps,
      activeIndex,
      percent: progressPercent(activeIndex, Math.max(1, steps.length - 1)),
      error,
    });
  }

  function clearProgressDelayed(): void {
    window.setTimeout(() => setProgressRun(null), 450);
  }

  async function yieldToUi(ms = 40): Promise<void> {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function clearPreviewProgressFallback(): void {
    if (previewProgressTimeoutRef.current !== null) {
      window.clearTimeout(previewProgressTimeoutRef.current);
      previewProgressTimeoutRef.current = null;
    }
  }

  function finishPreviewProgress(steps: string[] = previewSteps): void {
    clearPreviewProgressFallback();
    showProgress(
      "preview",
      t.progressPreviewTitle,
      steps,
      Math.max(0, steps.length - 1),
    );
    clearProgressDelayed();
  }

  function schedulePreviewProgressFallback(
    steps: string[] = previewSteps,
  ): void {
    clearPreviewProgressFallback();
    previewProgressTimeoutRef.current = window.setTimeout(() => {
      waitingForThreePreviewProgressRef.current = false;
      finishPreviewProgress(steps);
      previewProgressTimeoutRef.current = null;
    }, 1800);
  }

  function startThreePreviewProgress(): void {
    if (!model) return;
    waitingForThreePreviewProgressRef.current = true;
    showProgress("preview", t.progress3dTitle, threePreviewSteps, 0);
    window.setTimeout(() => {
      if (waitingForThreePreviewProgressRef.current) {
        showProgress("preview", t.progress3dTitle, threePreviewSteps, 1);
      }
    }, 20);
    schedulePreviewProgressFallback(threePreviewSteps);
  }

  const loadSteps = useMemo(
    () => [
      t.progressLoadCollectFiles,
      t.progressLoadTemplate,
      t.progressLoadFilaments,
      t.progressLoadObj,
      t.progressLoadPostProcess,
    ],
    [t],
  );
  const paletteSteps = useMemo(
    () => [
      t.progressPaletteApplySettings,
      t.progressPaletteBuildPalette,
      t.progressPaletteBuildSequences,
      t.progressPaletteRefreshPreview,
    ],
    [t],
  );
  const colourAdjustmentSteps = useMemo(
    () => [
      t.progressColourAdjustmentApplySettings,
      t.progressColourAdjustmentRebuildColours,
      t.progressColourAdjustmentRefreshPreview,
    ],
    [t],
  );
  const virtualEditSteps = useMemo(
    () => [
      t.progressVirtualEditApply,
      t.progressVirtualEditRecalculate,
      t.progressVirtualEditRefresh,
    ],
    [t],
  );
  const suggestionSteps = useMemo(
    () => [
      t.progressSuggestionApplySettings,
      t.progressSuggestionScoreFilaments,
      t.progressSuggestionApplySlots,
      t.progressSuggestionRefreshVirtuals,
    ],
    [t],
  );
  const previewSteps = useMemo(
    () => [
      t.progressPreviewApplySettings,
      t.progressPreviewRebuild,
      t.progressPreviewDone,
    ],
    [t],
  );
  const threePreviewSteps = useMemo(
    () => [
      t.progress3dActivate,
      t.progress3dPrepareGeometry,
      t.progress3dBuildView,
    ],
    [t],
  );
  const exportSteps = useMemo(
    () => [
      t.progressExportPrepareGeometry,
      t.progressExportWriteSegmentation,
      t.progressExportBuild3mf,
      t.progressExportDownload,
    ],
    [t],
  );
  const projectSaveSteps = useMemo(
    () => [
      t.progressProjectCollectState,
      t.progressProjectEmbedFiles,
      t.progressProjectWriteJson,
      t.progressProjectDone,
    ],
    [t],
  );
  const projectLoadSteps = useMemo(
    () => [
      t.progressProjectReadJson,
      t.progressProjectRestoreFiles,
      t.progressProjectRestoreState,
      t.progressProjectDone,
    ],
    [t],
  );
  const orientationSteps = useMemo(
    () => [
      t.progressOrientationPrepare,
      t.progressOrientationApply,
      t.progressOrientationRefresh,
    ],
    [t],
  );

  async function handleLoadSelectedInputs(): Promise<void> {
    const hasAnyPendingInput = Boolean(
      pendingObjFile || pendingTemplateFile || pendingFilamentListFile,
    );
    if (!hasAnyPendingInput) return;
    showProgress("load", t.progressLoadTitle, loadSteps, 0);
    setFileLoadBusy(true);
    setStatus(t.loadingSelectedFiles);
    await yieldToUi();
    try {
      if (pendingTemplateFile) {
        showProgress("load", t.progressLoadTitle, loadSteps, 1);
        await onTemplateFile(pendingTemplateFile);
      }
      if (pendingFilamentListFile) {
        showProgress("load", t.progressLoadTitle, loadSteps, 2);
        await onFilamentListFile(pendingFilamentListFile);
      }
      if (pendingObjFile) {
        showProgress("load", t.progressLoadTitle, loadSteps, 3);
        await onObjFile(pendingObjFile);
        setActiveTab("physical");
      } else {
        setStatus(t.selectedFilesLoaded);
      }
      showProgress("load", t.progressLoadTitle, loadSteps, 4);
      setPendingObjFile(null);
      setPendingTemplateFile(null);
      setPendingFilamentListFile(null);
      setFilePickerResetKey((value) => value + 1);
      await yieldToUi(80);
    } catch (err) {
      showProgress(
        "load",
        t.progressLoadTitle,
        loadSteps,
        0,
        err instanceof Error ? err.message : String(err),
      );
      setStatus(
        `${t.error}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setFileLoadBusy(false);
      clearProgressDelayed();
    }
  }

  useEffect(() => {
    if (!model || largeModelComputationsDeferred) {
      if (largeModelComputationsDeferred) setPalette([]);
      return;
    }
    const pal = medianCutPalette(
      adjustedColors,
      appliedMaxColours,
      triangleAreaWeights,
      appliedAccentProtection,
    );
    setPalette(pal);

    if (waitingForPreviewAfterPaletteApplyRef.current) {
      window.setTimeout(() => {
        if (!previewBusyRef.current) {
          finishPaletteApply();
        }
      }, 120);
    }
  }, [
    model,
    adjustedColors,
    appliedMaxColours,
    appliedAccentProtection,
    triangleAreaWeights,
    largeModelComputationsDeferred,
  ]);

  async function onObjFile(
    file: File,
    options: { jumpToPhysical?: boolean } = {},
  ) {
    const jumpToPhysical = options.jumpToPhysical ?? true;
    setFileLoadBusy(true);
    setStatus(t.loadingFile);
    setModel(null);
    baseModelRef.current = null;
    orientationMatrixRef.current = [...IDENTITY_ORIENTATION_MATRIX];
    setLargeModelComputationsDeferred(false);
    setThreePreviewRequested(true);
    setForceThreePreview(false);
    setPalette([]);
    setSlots([]);
    setAssignmentOverrides({});
    setSelectedAssignmentKeys([]);
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    const fileHeader = await readFileHeaderText(file);
    const forceKeepCoordinateMode = isPrinterSpaceTextureBakingObjHeader(fileHeader);
    try {
      const parsed = await parseObjFile(file, (progress) => {
        if (progress.totalBytes && progress.loadedBytes !== undefined) {
          const pct = Math.min(
            100,
            Math.round((progress.loadedBytes / progress.totalBytes) * 100),
          );
          const tris = progress.triangleCount
            ? ` · ${progress.triangleCount.toLocaleString()} triangles`
            : "";
          setStatus(`${t.parsingObj} ${pct}%${tris}`);
        } else {
          setStatus(t.parsingObj);
        }
      });
      setLargeModelComputationsDeferred(false);
      const safeModelName = safeFileDisplayName(
        parsed.name || file.name,
        "model.obj",
      );
      modelFileRef.current = file;
      const loadedModel = { ...parsed, name: safeModelName };
      baseModelRef.current = loadedModel;
      orientationMatrixRef.current = [...IDENTITY_ORIENTATION_MATRIX];
      setModel(modelWithOrientationMatrix(loadedModel, orientationMatrixRef.current));
      // Always derive the export filename from the currently loaded model.
      // This keeps the export target predictable when users switch between OBJ files.
      setExportFileName(exportFileNameForModel(safeModelName));
      exportFileNameUserEditedRef.current = false;
      if (forceKeepCoordinateMode) {
        // Texture Baking exports are already written in printer/Z-up
        // coordinates. Do not let the generic auto heuristic rotate wide,
        // flat terrain models a second time in the VertexColor preview/export.
        setExportCoordinateMode("keep");
        setStatus("Texture Baking OBJ loaded. Coordinate mode: keep.");
      }
      if (jumpToPhysical) setActiveTab("physical");
    } catch (err) {
      setStatus(
        `${t.error}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setFileLoadBusy(false);
    }
  }

  useEffect(() => {
    if (!incomingObjFile) return;
    setActiveTab("model");
    void onObjFile(incomingObjFile, { jumpToPhysical: false }).finally(() => {
      setActiveTab("model");
      onIncomingObjConsumed?.();
    });
    // incomingObjNonce is the explicit handoff trigger from the shell.
    // onObjFile is intentionally not a dependency to avoid reloading on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingObjNonce]);

  async function onTemplateFile(file: File) {
    setTemplateBusy(true);
    setStatus(t.loadingTemplate);
    try {
      const [info, buffer] = await Promise.all([
        readTemplate3mf(file),
        file.arrayBuffer(),
      ]);
      templateFileRef.current = file;
      setTemplateInfo({
        ...info,
        fileName: safeFileDisplayName(info.fileName, "template.3mf"),
      });
      setTemplateArrayBuffer(buffer);
      if (info.bedSize) {
        setExportBedX(String(Math.round(info.bedSize.x)));
        setExportBedY(String(Math.round(info.bedSize.y)));
      }
      setStatus(
        info.physicalColours.length > 0
          ? t.templateLoaded
          : t.templateLoadedNoColours,
      );
    } catch (err) {
      templateFileRef.current = null;
      setTemplateInfo(null);
      setTemplateArrayBuffer(null);
      setStatus(
        `${t.error}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setTemplateBusy(false);
    }
  }

  async function onFilamentListFile(file: File) {
    setFilamentBusy(true);
    setStatus(t.loadingFilamentList);
    try {
      const text = await file.text();
      const parsed = parseFilamentList(text);
      filamentListFileRef.current = file;
      setLoadedFilaments(parsed);
      setFilamentListName(safeFileDisplayName(file.name, "filaments.txt"));
      setFilamentMaterialFilter("__all__");
      setAppliedFilamentMaterialFilter("__all__");
      setManualFilamentSelectionKeys([]);
      setSlots([]);
      setStatus(
        parsed.length > 0 ? t.filamentListLoaded : t.filamentListLoadedEmpty,
      );
    } catch (err) {
      filamentListFileRef.current = null;
      setLoadedFilaments([]);
      setFilamentListName("");
      setFilamentMaterialFilter("__all__");
      setAppliedFilamentMaterialFilter("__all__");
      setManualFilamentSelectionKeys([]);
      setStatus(
        `${t.error}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setFilamentBusy(false);
    }
  }

  function modelWithOrientationMatrix(
    sourceModel: MeshModel,
    matrix: OrientationMatrix,
  ): MeshModel {
    return {
      ...sourceModel,
      vertices: sourceModel.vertices.map((vertex) =>
        applyOrientationMatrixToVec3(vertex, matrix),
      ),
    };
  }

  function setVertexModelOrientationMatrix(
    matrix: OrientationMatrix,
    actionLabel = "orientation updated",
    sourceLabel = "model",
  ): void {
    const baseModel = baseModelRef.current;
    if (!baseModel) return;
    orientationMatrixRef.current = [...matrix];
    setModel(modelWithOrientationMatrix(baseModel, matrix));
    setStatus(`${t.modelOrientation}: ${actionLabel} (${sourceLabel}).`);
    window.requestAnimationFrame(() => previewRef.current?.fitToModel());
  }

  async function runVertexOrientationOperation(operation: () => void): Promise<void> {
    setOrientationBusy(true);
    showProgress("orientation", t.progressOrientationTitle, orientationSteps, 0);
    try {
      await yieldToUi(40);
      showProgress("orientation", t.progressOrientationTitle, orientationSteps, 1);
      await yieldToUi(20);
      operation();
      showProgress("orientation", t.progressOrientationTitle, orientationSteps, 2);
      await yieldToUi(20);
      showProgress(
        "orientation",
        t.progressOrientationTitle,
        orientationSteps,
        Math.max(0, orientationSteps.length - 1),
      );
      clearProgressDelayed();
    } catch (err) {
      showProgress(
        "orientation",
        t.progressOrientationTitle,
        orientationSteps,
        1,
        err instanceof Error ? err.message : String(err),
      );
      setStatus(`${t.modelOrientation}: orientation failed.`);
      clearProgressDelayed();
    } finally {
      setOrientationBusy(false);
    }
  }

  async function applyVertexModelRotation(
    command: ModelRotationCommand,
    sourceLabel = "model",
  ): Promise<void> {
    const rotation = orientationMatrixForQuarterTurn(command, "negZ");
    const nextMatrix = composeOrientationMatrices(
      rotation,
      orientationMatrixRef.current,
    );
    const labels: Record<ModelRotationCommand, string> = {
      left: "rotated left 90°",
      right: "rotated right 90°",
      forward: "rotated forward 90°",
      backward: "rotated backward 90°",
    };
    await runVertexOrientationOperation(() =>
      setVertexModelOrientationMatrix(nextMatrix, labels[command], sourceLabel),
    );
  }

  async function applyVertexFineRotation(sourceLabel = "model"): Promise<void> {
    const angle = Math.round(Math.max(-180, Math.min(180, fineRotationAngle)));
    if (Math.abs(angle) < 0.000001) return;
    const rotation = orientationMatrixForAxisAngle(fineRotationAxis, angle);
    const nextMatrix = composeOrientationMatrices(
      rotation,
      orientationMatrixRef.current,
    );
    await runVertexOrientationOperation(() =>
      setVertexModelOrientationMatrix(
        nextMatrix,
        `rotated ${angle}° around ${fineRotationAxis.toUpperCase()}`,
        sourceLabel,
      ),
    );
    setFineRotationAngle(0);
  }

  function setVertexCurrentOrientation(): void {
    setFineRotationAngle(0);
    setStatus(`${t.modelOrientation}: current orientation set.`);
    window.requestAnimationFrame(() => previewRef.current?.fitToModel());
  }

  async function resetVertexModelOrientation(sourceLabel = "model"): Promise<void> {
    setFineRotationAngle(0);
    await runVertexOrientationOperation(() =>
      setVertexModelOrientationMatrix(
        [...IDENTITY_ORIENTATION_MATRIX],
        "orientation reset to imported state",
        sourceLabel,
      ),
    );
  }

  function applyVertexModelOrientation(
    bottomSide: ModelBottomSide,
    sourceLabel = "model",
  ): void {
    if (bottomSide === "current") return;
    const command = orientationMatrixForBottomSide(bottomSide, "negZ");
    const nextMatrix = composeOrientationMatrices(
      command,
      orientationMatrixRef.current,
    );
    setVertexModelOrientationMatrix(
      nextMatrix,
      "orientation restored from project",
      sourceLabel,
    );
  }

  function buildSettingsObject(): Record<string, unknown> {
    return {
      lang,
      themeMode,
      previewBackground,
      previewMode,
      previewDisplayMode,
      webglLodMode,
      modelOrientationMatrix: orientationMatrixRef.current,
      physicalExtruders,
      physicalColourSource,
      presetName,
      manualPhysicalColours,
      pendingPhysicalExtruders,
      pendingPhysicalColourSource,
      pendingPresetName,
      pendingManualPhysicalColours,
      suggestionMode,
      appliedSuggestionMode,
      filamentMaterialFilter,
      appliedFilamentMaterialFilter,
      filamentSortKey,
      filamentSortDirection,
      manualFilamentSelectionKeys,
      filamentSlotMode,
      suggestionExpertSettings,
      appliedSuggestionExpertSettings,
      pendingMaxColours,
      appliedMaxColours,
      pendingBlendStepPercent,
      appliedBlendStepPercent,
      pendingAccentProtection,
      appliedAccentProtection,
      pendingVirtualMixPriority,
      appliedVirtualMixPriority,
      pendingMappingStrategy,
      appliedMappingStrategy,
      pendingVirtualPreviewLightness,
      appliedVirtualPreviewLightness,
      pendingAdjustments,
      appliedAdjustments,
      paletteEntries: serializePaletteEntries(palette),
      activePhysicalSlots: currentPhysicalSlots.map(serializePhysicalSlot),
      suggestionPhysicalSlots: slots.map(serializePhysicalSlot),
      activeManualSlotIndex,
      assignmentOverrides: serializeAssignmentOverrides(assignmentOverrides),
      selectedAssignmentKeys,
      assignmentTargetExtruder,
      virtualPlanFilter,
      exportFileName,
      exportCoordinateMode,
      exportScale,
      exportTargetHeight,
      exportPutOnBed,
      exportCenterOnBed,
      exportBedSource,
      exportBedX,
      exportBedY,
      exportDefaultExtruder,
    };
  }

  async function buildProjectExport(): Promise<string> {
    const files: Record<string, EmbeddedProjectFile> = {};
    if (saveProjectParts.model && modelFileRef.current) {
      files.modelObj = await fileToEmbeddedProjectFile(
        modelFileRef.current,
        "text/plain",
      );
    }
    if (saveProjectParts.template && templateFileRef.current) {
      files.template3mf = await fileToEmbeddedProjectFile(
        templateFileRef.current,
        "model/3mf",
      );
    }
    if (saveProjectParts.filamentList && filamentListFileRef.current) {
      files.filamentList = await fileToEmbeddedProjectFile(
        filamentListFileRef.current,
        "text/plain",
      );
    }

    const payload: Record<string, unknown> = {
      app: "VertexColor2ColorMix",
      version: SETTINGS_FILE_VERSION,
      kind: "project",
      savedAt: new Date().toISOString(),
      included: { ...saveProjectParts },
      files,
    };
    if (saveProjectParts.settings) payload.settings = buildSettingsObject();
    return JSON.stringify(payload, null, 2);
  }

  async function handleSaveSettings() {
    setSettingsBusy(true);
    setStatus(t.savingProject);
    showProgress("project", t.progressProjectSaveTitle, projectSaveSteps, 0);
    await yieldToUi(30);
    try {
      const fileName = projectFileBaseName(model?.name);
      showProgress("project", t.progressProjectSaveTitle, projectSaveSteps, 1);
      await yieldToUi(30);
      const projectJson = await buildProjectExport();
      showProgress("project", t.progressProjectSaveTitle, projectSaveSteps, 2);
      await yieldToUi(30);
      downloadText(fileName, projectJson, "application/json;charset=utf-8");
      showProgress("project", t.progressProjectSaveTitle, projectSaveSteps, 3);
      clearProgressDelayed();
    } catch (err) {
      showProgress(
        "project",
        t.progressProjectSaveTitle,
        projectSaveSteps,
        0,
        err instanceof Error ? err.message : String(err),
      );
      setStatus(
        `${t.error}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSettingsBusy(false);
    }
  }

  function applySettingsObject(settings: Record<string, unknown>): void {
    const nextLang: Lang = "en";
    const nextThemeMode =
      typeof settings.themeMode === "string" && isThemeMode(settings.themeMode)
        ? settings.themeMode
        : themeMode;
    const nextPreviewBackground = isPreviewBackground(
      settings.previewBackground,
    )
      ? settings.previewBackground
      : previewBackground;
    const nextPreviewMode = isPreviewMode(settings.previewMode)
      ? settings.previewMode
      : previewMode;
    const nextPreviewDisplayMode = isPreviewDisplayMode(
      settings.previewDisplayMode,
    )
      ? settings.previewDisplayMode
      : previewDisplayMode;
    const nextPhysicalColourSource = isPhysicalColourSource(
      settings.physicalColourSource,
    )
      ? settings.physicalColourSource
      : physicalColourSource;
    const nextSuggestionMode = isSuggestionMode(settings.suggestionMode)
      ? settings.suggestionMode
      : suggestionMode;
    const nextAppliedSuggestionMode = isSuggestionMode(
      settings.appliedSuggestionMode,
    )
      ? settings.appliedSuggestionMode
      : nextSuggestionMode;
    const nextVirtualPlanFilter = isVirtualPlanFilter(
      settings.virtualPlanFilter,
    )
      ? settings.virtualPlanFilter
      : virtualPlanFilter;
    const nextPhysicalExtruders = Math.max(
      3,
      Math.min(
        8,
        Math.round(
          numberSetting(settings.physicalExtruders, physicalExtruders),
        ),
      ),
    );
    const pendingMaxFromFile = numberSetting(
      settings.pendingMaxColours,
      pendingMaxColours,
    );
    const nextPendingMaxColours = normalizeMaxColours(pendingMaxFromFile);
    const nextAppliedMaxColours = normalizeMaxColours(
      numberSetting(settings.appliedMaxColours, pendingMaxFromFile),
    );
    const pendingBlendStepFromFile = numberSetting(
      settings.pendingBlendStepPercent,
      pendingBlendStepPercent,
    );
    const nextPendingBlendStep = normalizeBlendStepPercent(
      pendingBlendStepFromFile,
      appliedBlendStepPercent,
    );
    const nextAppliedBlendStep = normalizeBlendStepPercent(
      numberSetting(settings.appliedBlendStepPercent, pendingBlendStepFromFile),
      nextPendingBlendStep,
    );
    const nextPendingAccentProtection = isAccentProtectionMode(
      settings.pendingAccentProtection,
    )
      ? settings.pendingAccentProtection
      : "off";
    const nextAppliedAccentProtection = isAccentProtectionMode(
      settings.appliedAccentProtection,
    )
      ? settings.appliedAccentProtection
      : nextPendingAccentProtection;
    const nextPendingVirtualMixPriority = isVirtualMixPriorityMode(
      settings.pendingVirtualMixPriority,
    )
      ? settings.pendingVirtualMixPriority
      : "accurate";
    const nextAppliedVirtualMixPriority = isVirtualMixPriorityMode(
      settings.appliedVirtualMixPriority,
    )
      ? settings.appliedVirtualMixPriority
      : nextPendingVirtualMixPriority;
    const nextPendingMappingStrategy = isMappingStrategyMode(
      settings.pendingMappingStrategy,
    )
      ? settings.pendingMappingStrategy
      : "closest";
    const nextAppliedMappingStrategy = isMappingStrategyMode(
      settings.appliedMappingStrategy,
    )
      ? settings.appliedMappingStrategy
      : nextPendingMappingStrategy;
    const nextPendingVirtualPreviewLightness = normalizeVirtualPreviewLightness(
      settings.pendingVirtualPreviewLightness,
      pendingVirtualPreviewLightness,
    );
    const nextAppliedVirtualPreviewLightness = normalizeVirtualPreviewLightness(
      settings.appliedVirtualPreviewLightness,
      nextPendingVirtualPreviewLightness,
    );

    setLang(nextLang);
    setThemeMode(nextThemeMode);
    setPreviewBackground(nextPreviewBackground);
    setPreviewMode(nextPreviewMode);
    setPreviewDisplayMode(nextPreviewDisplayMode);
    setWebglLodMode(
      isWebglLodMode(settings.webglLodMode)
        ? settings.webglLodMode
        : settings.webglPreviewLodEnabled === true
          ? "small"
          : webglLodMode,
    );
    if (isOrientationMatrix(settings.modelOrientationMatrix)) {
      const matrix = [...settings.modelOrientationMatrix] as OrientationMatrix;
      if (baseModelRef.current) {
        setVertexModelOrientationMatrix(
          matrix,
          "orientation restored from project",
          "project",
        );
      } else {
        orientationMatrixRef.current = matrix;
          }
    } else if (isModelBottomSide(settings.modelBottomSide)) {
      if (baseModelRef.current && settings.modelBottomSide !== "current") {
        applyVertexModelOrientation(settings.modelBottomSide, "project");
      } else {
            orientationMatrixRef.current = [...IDENTITY_ORIENTATION_MATRIX];
      }
    }
    const nextPresetName = stringSetting(settings.presetName, presetName);
    const nextManualPhysicalColours = stringSetting(
      settings.manualPhysicalColours,
      manualPhysicalColours,
    );
    const nextPendingPhysicalExtruders = Math.max(
      3,
      Math.min(
        8,
        Math.round(
          numberSetting(
            settings.pendingPhysicalExtruders,
            nextPhysicalExtruders,
          ),
        ),
      ),
    );
    const nextPendingPhysicalColourSource = isPhysicalColourSource(
      settings.pendingPhysicalColourSource,
    )
      ? settings.pendingPhysicalColourSource
      : nextPhysicalColourSource;
    const nextPendingPresetName = stringSetting(
      settings.pendingPresetName,
      nextPresetName,
    );
    const nextPendingManualPhysicalColours = stringSetting(
      settings.pendingManualPhysicalColours,
      nextManualPhysicalColours,
    );

    setPhysicalExtruders(nextPhysicalExtruders);
    setPhysicalColourSource(nextPhysicalColourSource);
    setPresetName(nextPresetName);
    setManualPhysicalColours(nextManualPhysicalColours);
    setPendingPhysicalExtruders(nextPendingPhysicalExtruders);
    setPendingPhysicalColourSource(nextPendingPhysicalColourSource);
    setPendingPresetName(nextPendingPresetName);
    setPendingManualPhysicalColours(nextPendingManualPhysicalColours);
    const nextFilamentMaterialFilter =
      typeof settings.filamentMaterialFilter === "string"
        ? settings.filamentMaterialFilter
        : "__all__";
    const nextAppliedFilamentMaterialFilter =
      typeof settings.appliedFilamentMaterialFilter === "string"
        ? settings.appliedFilamentMaterialFilter
        : nextFilamentMaterialFilter;
    setSuggestionMode(nextSuggestionMode);
    setAppliedSuggestionMode(nextAppliedSuggestionMode);
    setFilamentMaterialFilter(nextFilamentMaterialFilter);
    setAppliedFilamentMaterialFilter(nextAppliedFilamentMaterialFilter);
    setFilamentSortKey(
      settings.filamentSortKey === "assign" ||
        settings.filamentSortKey === "material" ||
        settings.filamentSortKey === "colour"
        ? settings.filamentSortKey
        : "name",
    );
    setFilamentSortDirection(
      settings.filamentSortDirection === "desc" ? "desc" : "asc",
    );
    const restoredSuggestionSlots = restorePhysicalSlots(
      settings.suggestionPhysicalSlots ??
        settings.physicalSlots ??
        settings.activePhysicalSlots,
      nextPhysicalExtruders,
    );
    const restoredManualKeys = Array.isArray(
      settings.manualFilamentSelectionKeys,
    )
      ? settings.manualFilamentSelectionKeys.filter(
          (x): x is string => typeof x === "string",
        )
      : restoredSuggestionSlots.length > 0
        ? slotKeysFromPhysicalSlots(
            restoredSuggestionSlots,
            nextPhysicalExtruders,
          )
        : [];
    setManualFilamentSelectionKeys(
      Array.from(
        { length: nextPhysicalExtruders },
        (_item, index) => restoredManualKeys[index] || "",
      ),
    );
    const loadedActiveManualSlot = Math.round(
      numberSetting(settings.activeManualSlotIndex, 0),
    );
    setActiveManualSlotIndex(
      Math.max(0, Math.min(nextPhysicalExtruders - 1, loadedActiveManualSlot)),
    );
    setFilamentSlotMode(
      settings.filamentSlotMode === "manual" ? "manual" : "suggested",
    );
    setSlots(
      nextPhysicalColourSource === "suggestion" ? restoredSuggestionSlots : [],
    );
    setPalette(
      restorePaletteEntries(settings.paletteEntries ?? settings.palette),
    );
    setAssignmentOverrides(
      restoreAssignmentOverrides(
        settings.assignmentOverrides,
        nextPhysicalExtruders,
      ),
    );
    setSelectedAssignmentKeys(
      Array.isArray(settings.selectedAssignmentKeys)
        ? settings.selectedAssignmentKeys.filter(
            (x): x is string => typeof x === "string",
          )
        : [],
    );
    setAssignmentTargetExtruder(
      Math.max(
        1,
        Math.min(
          nextPhysicalExtruders,
          Math.round(numberSetting(settings.assignmentTargetExtruder, 1)),
        ),
      ),
    );
    const nextSuggestionExpertSettings = restoreSuggestionExpertSettings(
      settings.suggestionExpertSettings,
      DEFAULT_SUGGESTION_EXPERT_SETTINGS,
    );
    const nextAppliedSuggestionExpertSettings = restoreSuggestionExpertSettings(
      settings.appliedSuggestionExpertSettings,
      nextSuggestionExpertSettings,
    );
    setSuggestionExpertSettings(nextSuggestionExpertSettings);
    setAppliedSuggestionExpertSettings(nextAppliedSuggestionExpertSettings);
    setPendingMaxColours(nextPendingMaxColours);
    setAppliedMaxColours(nextAppliedMaxColours);
    setPendingBlendStepPercent(nextPendingBlendStep);
    setAppliedBlendStepPercent(nextAppliedBlendStep);
    setPendingAccentProtection(nextPendingAccentProtection);
    setAppliedAccentProtection(nextAppliedAccentProtection);
    setPendingVirtualMixPriority(nextPendingVirtualMixPriority);
    setAppliedVirtualMixPriority(nextAppliedVirtualMixPriority);
    setPendingMappingStrategy(nextPendingMappingStrategy);
    setAppliedMappingStrategy(nextAppliedMappingStrategy);
    setPendingVirtualPreviewLightness(nextPendingVirtualPreviewLightness);
    setAppliedVirtualPreviewLightness(nextAppliedVirtualPreviewLightness);
    setPendingAdjustments((prev) =>
      restoreColourAdjustments(settings.pendingAdjustments, prev),
    );
    setAppliedAdjustments((prev) =>
      restoreColourAdjustments(settings.appliedAdjustments, prev),
    );
    setVirtualPlanFilter(nextVirtualPlanFilter);
    {
      const loadedExportFileName = stringSetting(
        settings.exportFileName,
        exportFileName,
      );
      setExportFileName(loadedExportFileName);
      exportFileNameUserEditedRef.current = Boolean(
        loadedExportFileName.trim(),
      );
    }
    setExportCoordinateMode(
      settings.exportCoordinateMode === "keep" ||
        settings.exportCoordinateMode === "blender-y-up" ||
        settings.exportCoordinateMode === "auto"
        ? settings.exportCoordinateMode
        : exportCoordinateMode,
    );
    setExportScale(stringSetting(settings.exportScale, exportScale));
    setExportTargetHeight(
      stringSetting(settings.exportTargetHeight, exportTargetHeight),
    );
    setExportPutOnBed(
      typeof settings.exportPutOnBed === "boolean"
        ? settings.exportPutOnBed
        : exportPutOnBed,
    );
    setExportCenterOnBed(
      typeof settings.exportCenterOnBed === "boolean"
        ? settings.exportCenterOnBed
        : exportCenterOnBed,
    );
    setExportBedSource(
      settings.exportBedSource === "custom" ||
        settings.exportBedSource === "template"
        ? settings.exportBedSource
        : exportBedSource,
    );
    setExportBedX(stringSetting(settings.exportBedX, exportBedX));
    setExportBedY(stringSetting(settings.exportBedY, exportBedY));
    setExportDefaultExtruder(
      Math.max(
        1,
        Math.min(
          8,
          Math.round(
            numberSetting(
              settings.exportDefaultExtruder,
              exportDefaultExtruder,
            ),
          ),
        ),
      ),
    );
  }

  async function onSettingsFile(file: File) {
    setSettingsBusy(true);
    setStatus(t.loadingSettings);
    showProgress("project", t.progressProjectLoadTitle, projectLoadSteps, 0);
    await yieldToUi(30);
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const root = recordOrNull(raw);
      if (!root) throw new Error(t.invalidSettingsFile);
      const files = recordOrNull(root.files);
      const hasProjectFiles = Boolean(files);
      let loadedAny = false;

      showProgress("project", t.progressProjectLoadTitle, projectLoadSteps, 1);
      await yieldToUi(30);
      if (loadProjectParts.model && files?.modelObj) {
        const objFile = embeddedProjectFileToFile(
          files.modelObj,
          "model.obj",
          "text/plain",
        );
        if (objFile) {
          await onObjFile(objFile);
          loadedAny = true;
        }
      }
      if (loadProjectParts.template && files?.template3mf) {
        const templateFile = embeddedProjectFileToFile(
          files.template3mf,
          "template.3mf",
          "model/3mf",
        );
        if (templateFile) {
          await onTemplateFile(templateFile);
          loadedAny = true;
        }
      }
      if (loadProjectParts.filamentList && files?.filamentList) {
        const filamentFile = embeddedProjectFileToFile(
          files.filamentList,
          "filaments.csv",
          "text/plain",
        );
        if (filamentFile) {
          await onFilamentListFile(filamentFile);
          loadedAny = true;
        }
      }

      showProgress("project", t.progressProjectLoadTitle, projectLoadSteps, 2);
      await yieldToUi(30);
      if (loadProjectParts.settings) {
        const settings =
          recordOrNull(root.settings) ?? (hasProjectFiles ? null : root);
        if (settings) {
          applySettingsObject(settings);
          loadedAny = true;
        }
      }

      if (!loadedAny) throw new Error(t.noSelectedProjectPartsFound);
      showProgress("project", t.progressProjectLoadTitle, projectLoadSteps, 3);
      clearProgressDelayed();
    } catch (err) {
      showProgress(
        "project",
        t.progressProjectLoadTitle,
        projectLoadSteps,
        0,
        err instanceof Error ? err.message : String(err),
      );
      setStatus(
        `${t.error}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSettingsBusy(false);
    }
  }

  function updateProjectPartSelection(
    direction: "save" | "load",
    part: ProjectPart,
    value: boolean,
  ): void {
    const updater = (prev: ProjectPartSelection): ProjectPartSelection => ({
      ...prev,
      [part]: value,
    });
    if (direction === "save") setSaveProjectParts(updater);
    else setLoadProjectParts(updater);
  }

  function updatePendingAdjustment<K extends keyof ColourAdjustments>(
    key: K,
    value: number,
  ) {
    setPendingAdjustments((prev) => ({ ...prev, [key]: value }));
  }

  function sameAdjustments(
    a: ColourAdjustments,
    b: ColourAdjustments,
  ): boolean {
    return (
      a.brightness === b.brightness &&
      a.contrast === b.contrast &&
      a.saturation === b.saturation &&
      a.temperature === b.temperature &&
      a.hue === b.hue &&
      a.tint === b.tint &&
      a.gamma === b.gamma
    );
  }

  useEffect(() => {
    const wasGreyscalePresetActive = greyscalePresetWasActiveRef.current;

    // Preset changes must not start an implicit expensive preview rebuild.
    // They only prepare the pending colour-adjustment values. The user applies
    // the change explicitly with the Apply button. This avoids mixed/partial
    // colour states on very large models and prevents browsers from hanging
    // during preset switching.
    if (colourApplyTimeoutRef.current !== null) {
      window.clearTimeout(colourApplyTimeoutRef.current);
      colourApplyTimeoutRef.current = null;
    }
    waitingForPreviewAfterApplyRef.current = false;
    setColourApplyBusy(false);

    if (greyscalePresetActive) {
      if (!wasGreyscalePresetActive) {
        adjustmentsBeforeGreyscalePresetRef.current = {
          pending: { ...pendingAdjustments },
          applied: { ...appliedAdjustments },
        };
      }
      greyscalePresetWasActiveRef.current = true;

      const base =
        adjustmentsBeforeGreyscalePresetRef.current?.pending ??
        pendingAdjustments;
      const nextPending = greyscaleAdjustmentsFrom(base);
      if (!sameAdjustments(nextPending, pendingAdjustments)) {
        setPendingAdjustments(nextPending);
      }
      return;
    }

    if (!wasGreyscalePresetActive) return;

    greyscalePresetWasActiveRef.current = false;
    const previous = adjustmentsBeforeGreyscalePresetRef.current ?? {
      pending: defaultAdjustments,
      applied: defaultAdjustments,
    };
    adjustmentsBeforeGreyscalePresetRef.current = null;

    if (!sameAdjustments(previous.pending, pendingAdjustments)) {
      setPendingAdjustments(previous.pending);
    }

    // Leaving a grey-scale preset restores the stored colour adjustment values,
    // but recalculation remains explicit so preset switching does not trigger
    // hidden heavy work.
    // Intentionally reacts only to the source/preset switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physicalColourSource, presetName]);

  function scheduleColourApplyFallback() {
    if (colourApplyTimeoutRef.current !== null)
      window.clearTimeout(colourApplyTimeoutRef.current);
    colourApplyTimeoutRef.current = window.setTimeout(() => {
      waitingForPreviewAfterApplyRef.current = false;
      showProgress(
        "adjustment",
        t.progressColourAdjustmentTitle,
        colourAdjustmentSteps,
        Math.max(0, colourAdjustmentSteps.length - 1),
      );
      setColourApplyBusy(false);
      clearProgressDelayed();
      colourApplyTimeoutRef.current = null;
    }, 1800);
  }

  function finishColourApply() {
    if (!waitingForPreviewAfterApplyRef.current) return;
    waitingForPreviewAfterApplyRef.current = false;
    if (colourApplyTimeoutRef.current !== null) {
      window.clearTimeout(colourApplyTimeoutRef.current);
      colourApplyTimeoutRef.current = null;
    }
    window.setTimeout(() => {
      showProgress(
        "adjustment",
        t.progressColourAdjustmentTitle,
        colourAdjustmentSteps,
        Math.max(0, colourAdjustmentSteps.length - 1),
      );
      setColourApplyBusy(false);
      clearProgressDelayed();
    }, 80);
  }

  function schedulePaletteApplyFallback() {
    if (paletteApplyTimeoutRef.current !== null)
      window.clearTimeout(paletteApplyTimeoutRef.current);
    paletteApplyTimeoutRef.current = window.setTimeout(() => {
      waitingForPreviewAfterPaletteApplyRef.current = false;
      setPaletteApplyBusy(false);
      paletteApplyTimeoutRef.current = null;
    }, 1800);
  }

  const adjustmentsDirty = !sameAdjustments(
    pendingAdjustments,
    appliedAdjustments,
  );

  const colourAdjustmentPresetNotice =
    physicalColourSource === "preset" && adjustmentsDirty
      ? isGreyscalePreset(presetName)
        ? t.greyscalePresetNeedsColourApply
        : t.colourPresetNeedsColourApply
      : "";

  function handleApplyAdjustments() {
    const next = { ...pendingAdjustments };
    showProgress(
      "adjustment",
      t.progressColourAdjustmentTitle,
      colourAdjustmentSteps,
      0,
    );
    if (!model) {
      setAppliedAdjustments(next);
      showProgress(
        "adjustment",
        t.progressColourAdjustmentTitle,
        colourAdjustmentSteps,
        Math.max(0, colourAdjustmentSteps.length - 1),
      );
      clearProgressDelayed();
      return;
    }

    setColourApplyBusy(true);
    setStatus(t.applyingColourAdjustment);

    if (!threePreviewActive) {
      waitingForPreviewAfterApplyRef.current = false;
      if (colourApplyTimeoutRef.current !== null) {
        window.clearTimeout(colourApplyTimeoutRef.current);
        colourApplyTimeoutRef.current = null;
      }
      window.setTimeout(() => {
        showProgress(
          "adjustment",
          t.progressColourAdjustmentTitle,
          colourAdjustmentSteps,
          1,
        );
        setAppliedAdjustments(next);
        window.setTimeout(() => {
          showProgress(
            "adjustment",
            t.progressColourAdjustmentTitle,
            colourAdjustmentSteps,
            Math.max(0, colourAdjustmentSteps.length - 1),
          );
          setColourApplyBusy(false);
          clearProgressDelayed();
        }, 120);
      }, 40);
      return;
    }

    waitingForPreviewAfterApplyRef.current = true;
    scheduleColourApplyFallback();

    window.setTimeout(() => {
      showProgress(
        "adjustment",
        t.progressColourAdjustmentTitle,
        colourAdjustmentSteps,
        1,
      );
      setAppliedAdjustments(next);
    }, 40);
  }

  function handleResetPendingAdjustments() {
    setPendingAdjustments(defaultAdjustments);
  }

  const paletteDirty =
    pendingMaxColours !== appliedMaxColours ||
    pendingBlendStepPercent !== appliedBlendStepPercent ||
    pendingAccentProtection !== appliedAccentProtection ||
    pendingVirtualMixPriority !== appliedVirtualMixPriority ||
    pendingMappingStrategy !== appliedMappingStrategy ||
    pendingVirtualPreviewLightness !== appliedVirtualPreviewLightness;

  function normalizeMaxColours(value: number): number {
    if (!Number.isFinite(value)) return appliedMaxColours;
    return Math.max(1, Math.min(256, Math.round(value)));
  }

  function handleApplyPaletteSettings() {
    const next = normalizeMaxColours(pendingMaxColours);
    const nextStep = normalizeBlendStepPercent(
      pendingBlendStepPercent,
      appliedBlendStepPercent,
    );
    const nextAccentProtection = isAccentProtectionMode(pendingAccentProtection)
      ? pendingAccentProtection
      : "off";
    const nextVirtualMixPriority = isVirtualMixPriorityMode(
      pendingVirtualMixPriority,
    )
      ? pendingVirtualMixPriority
      : "accurate";
    const nextMappingStrategy = isMappingStrategyMode(pendingMappingStrategy)
      ? pendingMappingStrategy
      : "closest";
    const nextVirtualPreviewLightness = normalizeVirtualPreviewLightness(
      pendingVirtualPreviewLightness,
      0,
    );
    setPendingMaxColours(next);
    setPendingBlendStepPercent(nextStep);
    setPendingAccentProtection(nextAccentProtection);
    setPendingVirtualMixPriority(nextVirtualMixPriority);
    setPendingMappingStrategy(nextMappingStrategy);
    setPendingVirtualPreviewLightness(nextVirtualPreviewLightness);
    if (!model) {
      setAppliedMaxColours(next);
      setAppliedBlendStepPercent(nextStep);
      setAppliedAccentProtection(nextAccentProtection);
      setAppliedVirtualMixPriority(nextVirtualMixPriority);
      setAppliedMappingStrategy(nextMappingStrategy);
      setAppliedVirtualPreviewLightness(nextVirtualPreviewLightness);
      return;
    }

    setPaletteApplyBusy(true);
    setStatus(t.applyingPaletteSettings);
    showProgress("palette", t.progressPaletteTitle, paletteSteps, 0);
    waitingForPreviewAfterPaletteApplyRef.current = true;
    schedulePaletteApplyFallback();

    window.setTimeout(() => {
      showProgress("palette", t.progressPaletteTitle, paletteSteps, 1);
      setAssignmentOverrides({});
      setSelectedAssignmentKeys([]);
      setAppliedMaxColours(next);
      setAppliedBlendStepPercent(nextStep);
      setAppliedAccentProtection(nextAccentProtection);
      setAppliedVirtualMixPriority(nextVirtualMixPriority);
      setAppliedMappingStrategy(nextMappingStrategy);
      setAppliedVirtualPreviewLightness(nextVirtualPreviewLightness);
    }, 40);
  }

  function handleResetPaletteSettings() {
    setPendingMaxColours(appliedMaxColours);
    setPendingBlendStepPercent(appliedBlendStepPercent);
    setPendingAccentProtection(appliedAccentProtection);
    setPendingVirtualMixPriority(appliedVirtualMixPriority);
    setPendingMappingStrategy(appliedMappingStrategy);
    setPendingVirtualPreviewLightness(appliedVirtualPreviewLightness);
  }

  function finishPaletteApply() {
    if (!waitingForPreviewAfterPaletteApplyRef.current) return;
    waitingForPreviewAfterPaletteApplyRef.current = false;
    if (paletteApplyTimeoutRef.current !== null) {
      window.clearTimeout(paletteApplyTimeoutRef.current);
      paletteApplyTimeoutRef.current = null;
    }
    window.setTimeout(() => {
      showProgress("palette", t.progressPaletteTitle, paletteSteps, 3);
      setPaletteApplyBusy(false);
      clearProgressDelayed();
    }, 80);
  }

  function handlePreviewBusyChange(busy: boolean) {
    previewBusyRef.current = busy;
    setPreviewBusy(busy);
    if (busy && waitingForThreePreviewProgressRef.current) {
      showProgress("preview", t.progress3dTitle, threePreviewSteps, 2);
    }
    if (!busy && waitingForThreePreviewProgressRef.current) {
      waitingForThreePreviewProgressRef.current = false;
      finishPreviewProgress(threePreviewSteps);
    }
    if (!busy && waitingForPreviewAfterPaletteApplyRef.current) {
      finishPaletteApply();
    }
    if (!busy && waitingForPreviewAfterApplyRef.current) {
      finishColourApply();
    }
  }

  function handlePreviewModeChange(next: PreviewMode): void {
    if (next === previewMode) return;
    setPreviewMode(next);
  }

  function handlePreviewDisplayModeChange(next: PreviewDisplayMode): void {
    if (next === previewDisplayMode) return;
    setPreviewDisplayMode(next);
  }

  function handlePreviewBackgroundChange(next: PreviewBackground): void {
    if (next === previewBackground) return;
    setPreviewBackground(next);
  }

  const fixedPhysicalFilaments = useMemo(() => {
    if (physicalColourSource === "preset")
      return filamentsFromPreset(presetName, physicalExtruders, (token) =>
        presetColourTokenLabel(token, t),
      );
    if (physicalColourSource === "template")
      return templateInfo
        ? filamentsFromTemplateColours(
            templateInfo.physicalColours,
            physicalExtruders,
          )
        : [];
    if (physicalColourSource === "manual")
      return filamentsFromHexText(manualPhysicalColours, physicalExtruders);
    return [];
  }, [
    manualPhysicalColours,
    physicalColourSource,
    physicalExtruders,
    presetName,
    templateInfo,
    t,
  ]);

  const currentPhysicalSlots = useMemo(() => {
    if (physicalColourSource === "suggestion") {
      return normalizePhysicalSlotsForCount(slots, physicalExtruders);
    }
    return fixedSlotsFromFilaments(fixedPhysicalFilaments, physicalExtruders);
  }, [fixedPhysicalFilaments, physicalColourSource, physicalExtruders, slots]);

  const activeSuggestionSlotKeys = useMemo(() => {
    return physicalColourSource === "suggestion"
      ? slotKeysFromPhysicalSlots(slots, physicalExtruders)
      : Array.from({ length: physicalExtruders }, () => "");
  }, [physicalColourSource, physicalExtruders, slots]);

  const suggestionSettingsDirty =
    suggestionMode !== appliedSuggestionMode ||
    filamentMaterialFilter !== appliedFilamentMaterialFilter ||
    !sameSuggestionExpertSettings(
      suggestionExpertSettings,
      appliedSuggestionExpertSettings,
    );

  const suggestionDraftDirty =
    suggestionSettingsDirty ||
    !sameStringArray(draftFilamentSelectionKeys, activeSuggestionSlotKeys);

  const suggestionDraftComplete = manualFilamentSlots.every(Boolean);
  const missingSuggestionSlots = useMemo(
    () =>
      manualFilamentSlots
        .map((filament, index) => (filament ? "" : `E${index + 1}`))
        .filter(Boolean),
    [manualFilamentSlots],
  );
  const suggestionDraftReadyToApply =
    filamentSuggestionEnabled &&
    suggestionDraftComplete &&
    suggestionDraftDirty;

  const physicalSlotRgbByNumber = useMemo(() => {
    const map = new Map<number, RGB>();
    for (const slot of currentPhysicalSlots)
      map.set(slot.slot, slot.filament.effectiveRgb);
    return map;
  }, [currentPhysicalSlots]);

  const baseVirtualExtruderPlan = useMemo(() => {
    return buildVirtualExtruderPlan(palette, currentPhysicalSlots, {
      maxComponents: 3,
      virtualStartId: physicalExtruders + 1,
      purePhysicalThreshold: 0.985,
      ratioStepPercent: appliedBlendStepPercent,
      accentProtection: appliedAccentProtection,
      mixPriority: appliedVirtualMixPriority,
      mappingStrategy: appliedMappingStrategy,
      previewLightnessOffset: appliedVirtualPreviewLightness,
    });
  }, [
    currentPhysicalSlots,
    palette,
    physicalExtruders,
    appliedBlendStepPercent,
    appliedAccentProtection,
    appliedVirtualMixPriority,
    appliedMappingStrategy,
    appliedVirtualPreviewLightness,
  ]);

  const virtualExtruderPlan = useMemo(() => {
    return applyAssignmentOverridesToPlan(
      baseVirtualExtruderPlan,
      palette,
      currentPhysicalSlots,
      assignmentOverrides,
    );
  }, [
    baseVirtualExtruderPlan,
    palette,
    currentPhysicalSlots,
    assignmentOverrides,
  ]);

  useEffect(() => {
    const validPalette = new Set(palette.map((entry) => entry.index));
    setAssignmentOverrides((prev) => {
      const next: Record<number, AssignmentOverride> = {};
      let changed = false;
      for (const [rawKey, override] of Object.entries(prev)) {
        const key = Number(rawKey);
        if (!validPalette.has(key)) {
          changed = true;
          continue;
        }
        if (override.kind === "physical") {
          if (override.extruder < 1 || override.extruder > physicalExtruders) {
            changed = true;
            continue;
          }
          next[key] = override;
        } else if (validPalette.has(override.targetPaletteIndex)) {
          next[key] = override;
        } else {
          changed = true;
        }
      }
      return changed || Object.keys(next).length !== Object.keys(prev).length
        ? next
        : prev;
    });
    setSelectedAssignmentKeys((prev) =>
      prev.filter((key) => {
        if (key.startsWith("v:")) {
          const id = Number(key.slice(2));
          return baseVirtualExtruderPlan.virtualBlends.some(
            (entry) => entry.virtualId === id,
          );
        }
        if (key.startsWith("p:")) return validPalette.has(Number(key.slice(2)));
        return false;
      }),
    );
    setAssignmentTargetExtruder((prev) =>
      Math.max(1, Math.min(prev, physicalExtruders)),
    );
  }, [baseVirtualExtruderPlan, palette, physicalExtruders]);

  const effectivePaletteRgbByIndex = useMemo(() => {
    const map = new Map<number, RGB>();
    for (const entry of virtualExtruderPlan.virtualBlends) {
      for (const paletteIndex of entry.targetPaletteIndices)
        map.set(paletteIndex, entry.displayRgb);
    }
    for (const entry of virtualExtruderPlan.physicalOnly) {
      for (const paletteIndex of entry.targetPaletteIndices)
        map.set(paletteIndex, entry.physicalRgb);
    }
    return map;
  }, [virtualExtruderPlan]);

  function handleRebuildPreview(): void {
    if (!model) return;
    clearPreviewProgressFallback();
    waitingForThreePreviewProgressRef.current = false;
    setPreviewResetKey((value) => value + 1);
    if (threePreviewRequested) startThreePreviewProgress();
  }

  function clearWorkingDataBeforeReload(): void {
    clearPreviewProgressFallback();
    waitingForPreviewAfterApplyRef.current = false;
    waitingForPreviewAfterPaletteApplyRef.current = false;
    waitingForThreePreviewProgressRef.current = false;
    setProgressRun(null);
    setModel(null);
    baseModelRef.current = null;
    orientationMatrixRef.current = [...IDENTITY_ORIENTATION_MATRIX];
    setLargeModelComputationsDeferred(false);
    setThreePreviewRequested(false);
    setForceThreePreview(false);
    setPalette([]);
    setSlots([]);
    setAssignmentOverrides({});
    setSelectedAssignmentKeys([]);
    setPendingObjFile(null);
    setPendingTemplateFile(null);
    setPendingFilamentListFile(null);
    setFilePickerResetKey((value) => value + 1);
    setTemplateInfo(null);
    setTemplateArrayBuffer(null);
    setLoadedFilaments([]);
    setFilamentListName("");
    setPreviewResetKey((value) => value + 1);
  }

  async function handleReloadData(): Promise<void> {
    const objFile = modelFileRef.current;
    if (!objFile) {
      setStatus(t.noReloadableData);
      return;
    }
    const templateFile = templateFileRef.current;
    const filamentFile = filamentListFileRef.current;

    showProgress("load", t.progressLoadTitle, loadSteps, 0);
    setFileLoadBusy(true);
    setStatus(t.reloadingData);
    await yieldToUi(40);
    try {
      clearWorkingDataBeforeReload();
      await clearBrowserRuntimeCaches();
      if (templateFile) {
        showProgress("load", t.progressLoadTitle, loadSteps, 1);
        await onTemplateFile(templateFile);
      }
      if (filamentFile) {
        showProgress("load", t.progressLoadTitle, loadSteps, 2);
        await onFilamentListFile(filamentFile);
      }
      showProgress("load", t.progressLoadTitle, loadSteps, 3);
      await onObjFile(objFile);
      showProgress("load", t.progressLoadTitle, loadSteps, 4);
      await yieldToUi(80);
    } catch (err) {
      showProgress(
        "load",
        t.progressLoadTitle,
        loadSteps,
        0,
        err instanceof Error ? err.message : String(err),
      );
      setStatus(
        `${t.error}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setFileLoadBusy(false);
      clearProgressDelayed();
    }
  }

  function handleReloadApp(): void {
    void clearBrowserRuntimeCaches().finally(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("vc2cmRefresh", String(Date.now()));
      window.location.replace(url.toString());
    });
  }

  useEffect(() => {
    if (reloadDataNonce <= 0) return;
    if (!modelFileRef.current) return;
    void handleReloadData();
    // reloadDataNonce is an explicit shell command. handleReloadData is intentionally not
    // a dependency because it is recreated with local workflow state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadDataNonce]);

  const sortedPaletteForDisplay = useMemo(
    () =>
      [...palette].sort(
        (a, b) =>
          compareRgbBySpectrum(a.rgb, b.rgb) ||
          b.count - a.count ||
          a.index - b.index,
      ),
    [palette],
  );

  const paletteBlockEntries = useMemo<PaletteBlockEntry[]>(
    () =>
      sortedPaletteForDisplay.map((entry) => ({
        key: `palette:${entry.index}`,
        rgb: entry.rgb,
        count: entry.count,
        label: `#${entry.index}`,
        title: `#${entry.index} · ${rgbToHex(entry.rgb)} · ${entry.count.toLocaleString()} ${t.trianglesShort}`,
      })),
    [sortedPaletteForDisplay, t.trianglesShort],
  );

  const effectiveColourBlockEntries = useMemo<PaletteBlockEntry[]>(() => {
    const entries: PaletteBlockEntry[] = [
      ...virtualExtruderPlan.virtualBlends.map((entry) => ({
        key: `v:${entry.virtualId}`,
        rgb: entry.displayRgb,
        count: entry.triangleCount,
        label: `VE${entry.virtualId}`,
        title: `VE${entry.virtualId} · ${rgbToHex(entry.displayRgb)} · ${entry.triangleCount.toLocaleString()} ${t.trianglesShort} · ${paletteIndexPreview(entry.targetPaletteIndices, 8)}`,
        selected: selectedAssignmentKeys.includes(`v:${entry.virtualId}`),
      })),
      ...virtualExtruderPlan.physicalOnly.map((entry) => ({
        key: `p:${entry.paletteIndex}`,
        rgb: entry.physicalRgb,
        count: entry.triangleCount,
        label: `E${entry.physicalExtruder}`,
        title: `E${entry.physicalExtruder} · ${entry.triangleCount.toLocaleString()} ${t.trianglesShort} · ${paletteIndexPreview(entry.targetPaletteIndices, 8)}`,
        selected: selectedAssignmentKeys.includes(`p:${entry.paletteIndex}`),
      })),
    ];
    return entries.sort(
      (a, b) =>
        compareRgbBySpectrum(a.rgb, b.rgb) ||
        b.count - a.count ||
        compareText(a.label, b.label),
    );
  }, [virtualExtruderPlan, selectedAssignmentKeys, t.trianglesShort]);

  const filteredVirtualBlends = useMemo(() => {
    if (virtualPlanFilter === "physical") return [];
    const blends =
      virtualPlanFilter === "merged"
        ? virtualExtruderPlan.virtualBlends.filter(
            (entry) => entry.targetPaletteIndices.length > 1,
          )
        : virtualExtruderPlan.virtualBlends;
    return blends;
  }, [virtualExtruderPlan, virtualPlanFilter]);

  const filteredPhysicalOnly = useMemo(() => {
    if (virtualPlanFilter === "merged")
      return virtualExtruderPlan.physicalOnly.filter(
        (entry) => entry.targetPaletteIndices.length > 1,
      );
    return virtualPlanFilter === "all" || virtualPlanFilter === "physical"
      ? virtualExtruderPlan.physicalOnly
      : [];
  }, [virtualExtruderPlan, virtualPlanFilter]);

  function paletteIndicesForAssignmentKey(key: string): number[] {
    if (key.startsWith("v:")) {
      const virtualId = Number(key.slice(2));
      return (
        virtualExtruderPlan.virtualBlends.find(
          (entry) => entry.virtualId === virtualId,
        )?.targetPaletteIndices ?? []
      );
    }
    if (key.startsWith("p:")) {
      const paletteIndex = Number(key.slice(2));
      const physicalEntry = virtualExtruderPlan.physicalOnly.find(
        (entry) => entry.paletteIndex === paletteIndex,
      );
      if (physicalEntry) return physicalEntry.targetPaletteIndices;
      return Number.isFinite(paletteIndex) ? [paletteIndex] : [];
    }
    return [];
  }

  const selectedPaletteIndices = useMemo(() => {
    const seen = new Set<number>();
    for (const key of selectedAssignmentKeys) {
      for (const paletteIndex of paletteIndicesForAssignmentKey(key))
        seen.add(paletteIndex);
    }
    return [...seen].sort((a, b) => a - b);
  }, [selectedAssignmentKeys, virtualExtruderPlan]);

  function toggleAssignmentSelection(key: string): void {
    setSelectedAssignmentKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  }

  async function runVirtualRecalculationProgress(
    statusMessage: string,
  ): Promise<void> {
    setVirtualEditBusy(true);
    showProgress("palette", t.progressVirtualEditTitle, virtualEditSteps, 0);
    await yieldToUi(60);
    showProgress("palette", t.progressVirtualEditTitle, virtualEditSteps, 1);
    await yieldToUi(80);
    showProgress("palette", t.progressVirtualEditTitle, virtualEditSteps, 2);
    setStatus(statusMessage);
    window.setTimeout(() => {
      setVirtualEditBusy(false);
      clearProgressDelayed();
    }, 120);
  }

  function handleSuggestionModeChange(next: SuggestionMode): void {
    if (next === suggestionMode) return;
    setSuggestionMode(next);
  }

  function handleMaterialFilterChange(next: string): void {
    if (next === filamentMaterialFilter) return;
    setFilamentMaterialFilter(next);
  }

  function handlePendingPhysicalExtruderCountChange(value: number): void {
    const next = Math.max(3, Math.min(8, Math.round(value)));
    setPendingPhysicalExtruders(next);
  }

  function handleResetPendingPhysicalSettings(): void {
    setPendingPhysicalExtruders(physicalExtruders);
    setPendingPhysicalColourSource(physicalColourSource);
    setPendingPresetName(presetName);
    setPendingManualPhysicalColours(manualPhysicalColours);
  }

  function handleApplyPhysicalSettings(): void {
    const nextExtruders = Math.max(
      3,
      Math.min(8, Math.round(pendingPhysicalExtruders)),
    );
    const changed =
      nextExtruders !== physicalExtruders ||
      pendingPhysicalColourSource !== physicalColourSource ||
      pendingPresetName !== presetName ||
      pendingManualPhysicalColours !== manualPhysicalColours;
    if (!changed) return;

    setPhysicalExtruders(nextExtruders);
    setPhysicalColourSource(pendingPhysicalColourSource);
    setPresetName(pendingPresetName);
    setManualPhysicalColours(pendingManualPhysicalColours);
    setSelectedAssignmentKeys([]);
    if (pendingPhysicalColourSource === "suggestion") {
      setSlots((prev) => normalizePhysicalSlotsForCount(prev, nextExtruders));
      setManualFilamentSelectionKeys((prev) =>
        Array.from(
          { length: nextExtruders },
          (_item, index) => prev[index] || "",
        ),
      );
      setActiveManualSlotIndex((prev) =>
        Math.max(0, Math.min(nextExtruders - 1, prev)),
      );
    }
    void runVirtualRecalculationProgress(t.virtualColoursRecalculated);
  }

  function mergeSelectedVirtualAssignments(): void {
    if (selectedPaletteIndices.length < 2) return;
    const targetPaletteIndex = selectedPaletteIndices[0];
    setAssignmentOverrides((prev) => {
      const next = { ...prev };
      for (const paletteIndex of selectedPaletteIndices) {
        if (paletteIndex === targetPaletteIndex) continue;
        next[paletteIndex] = { kind: "merge", targetPaletteIndex };
      }
      return next;
    });
    setSelectedAssignmentKeys([]);
    void runVirtualRecalculationProgress(t.virtualAssignmentsMerged);
  }

  function assignSelectedToPhysicalExtruder(): void {
    if (selectedPaletteIndices.length === 0) return;
    const extruder = Math.max(
      1,
      Math.min(physicalExtruders, assignmentTargetExtruder),
    );
    setAssignmentOverrides((prev) => {
      const next = { ...prev };
      for (const paletteIndex of selectedPaletteIndices) {
        next[paletteIndex] = { kind: "physical", extruder };
      }
      return next;
    });
    setSelectedAssignmentKeys([]);
    void runVirtualRecalculationProgress(t.virtualAssignmentsAssignedPhysical);
  }

  function resetAssignmentOverrides(): void {
    setAssignmentOverrides({});
    setSelectedAssignmentKeys([]);
    void runVirtualRecalculationProgress(t.virtualAssignmentsReset);
  }

  function assignmentOverrideCount(): number {
    return Object.keys(assignmentOverrides).length;
  }

  async function makeSuggestion(): Promise<void> {
    if (!filamentSuggestionEnabled) return;
    if (palette.length === 0 || filteredFilaments.length === 0) return;

    if (suggestionProgressTimeoutRef.current !== null) {
      window.clearTimeout(suggestionProgressTimeoutRef.current);
      suggestionProgressTimeoutRef.current = null;
    }

    const runId = suggestionRunIdRef.current + 1;
    suggestionRunIdRef.current = runId;
    setSuggestionBusy(true);
    setFilamentSlotMode("suggested");
    showProgress("suggestion", t.progressSuggestionTitle, suggestionSteps, 0);
    await yieldToUi(40);

    if (suggestionRunIdRef.current !== runId) return;
    showProgress("suggestion", t.progressSuggestionTitle, suggestionSteps, 1);
    await yieldToUi(40);

    const nextSlots = suggestPhysicalSlots(
      palette,
      filteredFilaments,
      physicalExtruders,
      suggestionOptions(
        suggestionMode,
        suggestionExpertSettings,
        appliedBlendStepPercent,
      ),
    );

    if (suggestionRunIdRef.current !== runId) return;
    showProgress("suggestion", t.progressSuggestionTitle, suggestionSteps, 2);
    const nextKeys = slotKeysFromPhysicalSlots(nextSlots, physicalExtruders);
    setManualFilamentSelectionKeys(nextKeys);
    setActiveManualSlotIndex(
      Math.max(
        0,
        nextKeys.findIndex((key) => !key),
      ),
    );
    showProgress("suggestion", t.progressSuggestionTitle, suggestionSteps, 3);
    window.setTimeout(() => {
      if (suggestionRunIdRef.current !== runId) return;
      setSuggestionBusy(false);
      clearProgressDelayed();
    }, 140);
  }

  function resetSuggestionDraft(): void {
    setSuggestionMode(appliedSuggestionMode);
    setFilamentMaterialFilter(appliedFilamentMaterialFilter);
    setSuggestionExpertSettings(appliedSuggestionExpertSettings);
    setManualFilamentSelectionKeys(activeSuggestionSlotKeys);
    setFilamentSlotMode("manual");
    setActiveManualSlotIndex(0);
  }

  async function applySuggestionDraft(): Promise<void> {
    if (!filamentSuggestionEnabled || !suggestionDraftComplete) return;
    setSuggestionBusy(true);
    showProgress("suggestion", t.progressSuggestionTitle, suggestionSteps, 0);
    await yieldToUi(40);
    setPhysicalColourSource("suggestion");
    setPendingPhysicalColourSource("suggestion");
    showProgress("suggestion", t.progressSuggestionTitle, suggestionSteps, 2);
    await yieldToUi(40);
    setSlots(
      fixedSlotsFromFilaments(manuallySelectedFilaments, physicalExtruders),
    );
    setAppliedSuggestionMode(suggestionMode);
    setAppliedFilamentMaterialFilter(filamentMaterialFilter);
    setAppliedSuggestionExpertSettings(suggestionExpertSettings);
    showProgress("suggestion", t.progressSuggestionTitle, suggestionSteps, 3);
    window.setTimeout(() => {
      setSuggestionBusy(false);
      clearProgressDelayed();
    }, 120);
  }

  function assignFilamentToManualSlot(
    filament: Filament,
    slotIndex = activeManualSlotIndex,
  ): void {
    if (!filamentSuggestionEnabled) return;
    const boundedSlotIndex = Math.max(
      0,
      Math.min(physicalExtruders - 1, slotIndex),
    );
    const key = filamentKey(filament);
    const next = Array.from(
      { length: physicalExtruders },
      (_, index) => draftFilamentSelectionKeys[index] || "",
    );
    for (let i = 0; i < next.length; i += 1) {
      if (i !== boundedSlotIndex && next[i] === key) next[i] = "";
    }
    next[boundedSlotIndex] = key;

    const followingEmptySlot = next.findIndex(
      (item, index) => index > boundedSlotIndex && !item,
    );
    setFilamentSlotMode("manual");
    setManualFilamentSelectionKeys(next);
    setActiveManualSlotIndex(
      followingEmptySlot >= 0 ? followingEmptySlot : boundedSlotIndex,
    );
  }

  function clearManualFilamentSlot(slotIndex: number): void {
    if (!filamentSuggestionEnabled) return;
    const boundedSlotIndex = Math.max(
      0,
      Math.min(physicalExtruders - 1, slotIndex),
    );
    const next = Array.from(
      { length: physicalExtruders },
      (_, index) => draftFilamentSelectionKeys[index] || "",
    );
    next[boundedSlotIndex] = "";
    setFilamentSlotMode("manual");
    setManualFilamentSelectionKeys(next);
    setActiveManualSlotIndex(boundedSlotIndex);
  }

  function clearManualFilamentSelection(): void {
    if (!filamentSuggestionEnabled) return;
    setFilamentSlotMode("manual");
    setManualFilamentSelectionKeys(
      Array.from({ length: physicalExtruders }, () => ""),
    );
    setActiveManualSlotIndex(0);
  }

  function changeFilamentSort(nextKey: FilamentSortKey): void {
    if (!filamentSuggestionEnabled) return;
    if (filamentSortKey === nextKey) {
      setFilamentSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setFilamentSortKey(nextKey);
    setFilamentSortDirection("asc");
  }

  useEffect(() => {
    if (physicalColourSource === "suggestion") return;
    setSlots([]);
  }, [physicalColourSource]);

  function numericInput(value: string, fallback: number): number {
    const parsed = Number(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function safeExportFileName(): string {
    const base =
      exportFileName.trim() ||
      (model
        ? exportFileNameForModel(model.name)
        : "vertexcolor2colormix_export.3mf");
    return base.toLowerCase().endsWith(".3mf") ? base : `${base}.3mf`;
  }

  async function handleExport3mf() {
    if (!model || palette.length === 0 || currentPhysicalSlots.length === 0)
      return;
    setExportBusy(true);
    setStatus(t.exporting3mf);
    showProgress("export", t.progressExportTitle, exportSteps, 0);
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    try {
      const targetHeight = exportTargetHeight.trim()
        ? numericInput(exportTargetHeight, 0)
        : null;
      showProgress("export", t.progressExportTitle, exportSteps, 1);
      await yieldToUi(20);
      const result = await buildPrusa3mfBlob({
        fileName: safeExportFileName(),
        templateArrayBuffer,
        templateInfo,
        model,
        adjustedColors,
        palette,
        physicalSlots: currentPhysicalSlots,
        virtualPlan: virtualExtruderPlan,
        placement: {
          coordinateMode: exportCoordinateMode,
          scale: numericInput(exportScale, 1),
          targetHeight,
          putOnBed: exportPutOnBed,
          centerOnBed: exportCenterOnBed,
          bedSource: exportBedSource,
          customBedSize: {
            x: numericInput(exportBedX, templateInfo?.bedSize?.x ?? 250),
            y: numericInput(exportBedY, templateInfo?.bedSize?.y ?? 210),
          },
          fallbackBedSize: { x: 250, y: 210 },
          defaultExtruder: exportDefaultExtruder,
        },
        updateExtruderColour: true,
        accentProtection: appliedAccentProtection,
      });
      showProgress("export", t.progressExportTitle, exportSteps, 3);
      await yieldToUi(20);
      downloadBlob(result.fileName, result.blob);
      setStatus(
        `${t.export3mfDone} ${result.summary.virtualCount} ${t.virtualExtrudersShort}, ${t.coordinateMode}: ${result.summary.coordinateMode}, ${t.scale}: ${result.summary.scale.toFixed(4)}`,
      );
    } catch (err) {
      showProgress(
        "export",
        t.progressExportTitle,
        exportSteps,
        0,
        err instanceof Error ? err.message : String(err),
      );
      setStatus(
        `${t.error}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setExportBusy(false);
      clearProgressDelayed();
    }
  }

  const globalBusy =
    fileLoadBusy ||
    colourApplyBusy ||
    paletteApplyBusy ||
    previewBusy ||
    templateBusy ||
    filamentBusy ||
    settingsBusy ||
    suggestionBusy ||
    exportBusy ||
    orientationBusy;
  const [settingsWidth, setSettingsWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem("vccm.settingsWidth"));
    return Number.isFinite(stored) && stored >= 480 && stored <= 980
      ? stored
      : 620;
  });

  useEffect(() => {
    window.localStorage.setItem("vccm.settingsWidth", String(settingsWidth));
  }, [settingsWidth]);

  function handleSettingsResizePointerDown(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = settingsWidth;
    const minWidth = 480;
    const maxWidth = Math.min(980, Math.max(560, window.innerWidth - 520));

    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.round(startWidth + moveEvent.clientX - startX);
      setSettingsWidth(Math.max(minWidth, Math.min(maxWidth, next)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function handleSettingsResizeReset() {
    setSettingsWidth(620);
  }

  const showOrientationAxisGuide = activeTab === "orientation";

  const tabs: Array<{
    id: SidebarTab;
    label: string;
    tip: string;
    disabled?: boolean;
  }> = [
    { id: "model", label: t.tabLoad, tip: t.stagedLoadIntro },
    {
      id: "orientation",
      label: t.modelOrientation,
      tip: t.tipModelOrientation,
    },
    {
      id: "physical",
      label: t.colourSetup,
      tip: "Prepare imported vertex colours, physical E-slot colours and filament-list suggestions before palette reduction.",
    },
    {
      id: "palette",
      label: t.tabPalette,
      tip: "Build the reduced target palette and virtual colour mixes.",
    },
    {
      id: "export",
      label: t.tabExport,
      tip: "Export the prepared 3MF and related reports.",
    },
    { id: "settings", label: t.tabSettings, tip: t.settingsHelp },
  ];

  return (
    <div className={`app theme-${resolvedTheme}`}>
      <header className="topbar">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        {!hideTopbarControls && (
          <div className="topbar-controls">
            <button
              type="button"
              className="secondary compact topbar-action"
              disabled={globalBusy || !modelFileRef.current}
              onClick={() => void handleReloadData()}
              title={t.tipReloadData}
            >
              {t.reloadData}
            </button>
            <button
              type="button"
              className="secondary compact topbar-action"
              disabled={globalBusy}
              onClick={handleReloadApp}
              title={t.tipReloadApp}
            >
              {t.reloadApp}
            </button>
            <label title={t.tipTheme}>
              <span>{t.theme}</span>
              <select
                value={themeMode}
                onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
              >
                <option value="system">{t.system}</option>
                <option value="light">{t.light}</option>
                <option value="dark">{t.dark}</option>
              </select>
            </label>
          </div>
        )}
      </header>

      <ProgressDialog run={progressRun} />

      <main
        className="layout"
        style={
          { "--settings-width": `${settingsWidth}px` } as React.CSSProperties
        }
      >
        <aside className="panel left-panel tabbed-panel">
          <nav className="sidebar-tabs" aria-label={t.settingsTabs}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
                disabled={tab.disabled}
                title={tab.tip}
                aria-label={tab.tip ? `${tab.label}: ${tab.tip}` : tab.label}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="tab-content">
            {activeTab === "model" && (
              <>
                <section className="card load-card staged-load-card">
                  <h2>{t.loadAndSetup}</h2>
                  <p className="muted">{t.stagedLoadIntro}</p>

                  <div className="staged-file-grid">
                    <label
                      className="file-drop staged-file-picker"
                      title={t.tipObjFile}
                    >
                      <span>{t.objFile}</span>
                      <strong>
                        {pendingObjFile
                          ? fileSummary(pendingObjFile)
                          : t.chooseFile}
                      </strong>
                      <input
                        disabled={fileLoadBusy}
                        type="file"
                        accept=".obj,text/plain"
                        key={`obj-${filePickerResetKey}`}
                        onChange={(e) =>
                          setPendingObjFile(e.target.files?.[0] ?? null)
                        }
                      />
                    </label>
                    <label
                      className="file-drop staged-file-picker"
                      title={t.templateIndependentNote}
                    >
                      <span>{t.template3mf}</span>
                      <strong>
                        {pendingTemplateFile
                          ? fileSummary(pendingTemplateFile)
                          : t.optionalFile}
                      </strong>
                      <input
                        disabled={fileLoadBusy}
                        type="file"
                        accept=".3mf"
                        key={`template-${filePickerResetKey}`}
                        onChange={(e) =>
                          setPendingTemplateFile(e.target.files?.[0] ?? null)
                        }
                      />
                    </label>
                    <label
                      className="file-drop staged-file-picker"
                      title={t.filamentListFileOnlyNote}
                    >
                      <span>{t.filamentList}</span>
                      <strong>
                        {pendingFilamentListFile
                          ? fileSummary(pendingFilamentListFile)
                          : t.optionalFile}
                      </strong>
                      <input
                        disabled={fileLoadBusy}
                        type="file"
                        accept=".txt,.csv,text/plain"
                        key={`filaments-${filePickerResetKey}`}
                        onChange={(e) =>
                          setPendingFilamentListFile(
                            e.target.files?.[0] ?? null,
                          )
                        }
                      />
                    </label>
                  </div>

                  <details className="file-summary full filament-format-details">
                    <summary>{t.filamentListFormatTitle}</summary>
                    <div className="format-note-body">
                      <p className="muted note">{t.filamentListFormatText}</p>
                      <div className="format-grid">
                        <b>{t.filamentListColumn1}</b>
                        <b>{t.filamentListColumn2}</b>
                        <b>{t.filamentListColumn3}</b>
                        <span>{t.filamentListColumn1Help}</span>
                        <span>{t.filamentListColumn2Help}</span>
                        <span>{t.filamentListColumn3Help}</span>
                      </div>
                      <pre className="format-example">
                        {t.filamentListFormatExample}
                      </pre>
                      <p className="muted note">{t.filamentListFormatNotes}</p>
                    </div>
                  </details>

                  <div className="staged-load-actions">
                    <button
                      type="button"
                      className="primary-action"
                      disabled={
                        !(
                          pendingObjFile ||
                          pendingTemplateFile ||
                          pendingFilamentListFile
                        ) || fileLoadBusy
                      }
                      onClick={handleLoadSelectedInputs}
                      title={t.tipLoadSelectedFiles}
                    >
                      {fileLoadBusy ? t.loading : t.loadSelectedFiles}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={
                        fileLoadBusy &&
                        !pendingObjFile &&
                        !pendingTemplateFile &&
                        !pendingFilamentListFile
                      }
                      onClick={() => {
                        setPendingObjFile(null);
                        setPendingTemplateFile(null);
                        setPendingFilamentListFile(null);
                        setFilePickerResetKey((value) => value + 1);
                      }}
                    >
                      {t.clearSelection}
                    </button>
                  </div>

                  {model ? (
                    <div className="stats">
                      <h3>{t.modelStats}</h3>
                      <div>
                        <span>{t.modelName}</span>
                        <b className="model-name-value" title={model.name}>
                          {model.name}
                        </b>
                      </div>
                      <div>
                        <span>{t.vertices}</span>
                        <b>{model.stats.vertexCount.toLocaleString()}</b>
                      </div>
                      <div>
                        <span>{t.triangles}</span>
                        <b>{model.stats.triangleCount.toLocaleString()}</b>
                      </div>
                      <div>
                        <span>{t.colouredVertices}</span>
                        <b>{model.stats.coloredVertexCount.toLocaleString()}</b>
                      </div>
                      <div>
                        <span>{t.uniqueFaceColours}</span>
                        <b>{model.stats.uniqueFaceColors.toLocaleString()}</b>
                      </div>
                    </div>
                  ) : (
                    <p className="muted">{t.noModel}</p>
                  )}

                  <div className="loaded-input-summary">
                    <div className="section-subtitle">
                      {t.currentLoadedInputs}
                    </div>
                    <div className="file-summary full">
                      <span>
                        {model ? `${t.objFile}: ${model.name}` : t.noModel}
                      </span>
                      <span>
                        {templateInfo
                          ? `${t.template3mf}: ${safeFileDisplayName(templateInfo.fileName, "template.3mf")}`
                          : t.noTemplateLoaded}
                      </span>
                      <span>
                        {filamentListName
                          ? `${t.filamentList}: ${safeFileDisplayName(filamentListName, "filaments.txt")} · ${loadedFilaments.length} ${t.parsedFilaments}`
                          : t.noFilamentListLoaded}
                      </span>
                    </div>
                  </div>
                </section>
              </>
            )}

            {activeTab === "orientation" && (
              <section className="card tab-card workflow-card">
                <h2>{t.modelOrientation}</h2>
                <p className="muted workflow-intro">{t.tipModelOrientation}</p>
                <div className="orientation-panel">
                  <div className="section-subtitle">{t.rotate90}</div>
                  <div className="adjustment-actions">
                    {([
                      ["left", t.rotateLeft],
                      ["right", t.rotateRight],
                      ["forward", t.rotateForward],
                      ["backward", t.rotateBackward],
                    ] as Array<[ModelRotationCommand, string]>).map(([command, label]) => (
                      <button
                        key={command}
                        type="button"
                        className="secondary"
                        onClick={() => void applyVertexModelRotation(command)}
                        disabled={!baseModelRef.current || globalBusy}
                        title={t.tipApplyOrientation}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="section-mini-title">{t.fineRotation}</div>
                  <div>
                    <label className="inline-row" title={t.tipFineRotation}>
                      <HelpLabel title={t.tipFineRotation}>
                        {t.rotationAxis}
                      </HelpLabel>
                      <select
                        value={fineRotationAxis}
                        disabled={!baseModelRef.current || globalBusy}
                        onChange={(e) =>
                          setFineRotationAxis(e.target.value as ModelRotationAxis)
                        }
                      >
                        <option value="x">X</option>
                        <option value="y">Y</option>
                        <option value="z">Z</option>
                      </select>
                    </label>
                    <label className="inline-row" title={t.tipFineRotation}>
                      <HelpLabel title={t.tipFineRotation}>
                        {t.rotationAngle}
                      </HelpLabel>
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        step={1}
                        value={fineRotationAngle}
                        disabled={!baseModelRef.current || globalBusy}
                        onChange={(e) =>
                          setFineRotationAngle(
                            Math.round(Math.max(-180, Math.min(180, Number(e.target.value) || 0))),
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="adjustment-actions">
                    <button
                      type="button"
                      onClick={() => void applyVertexFineRotation()}
                      disabled={
                        !baseModelRef.current ||
                        Math.abs(fineRotationAngle) < 0.000001 ||
                        globalBusy
                      }
                      title={t.tipFineRotation}
                    >
                      {t.applyFineRotation}
                    </button>
                  </div>

                  <div className="adjustment-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={setVertexCurrentOrientation}
                      disabled={!baseModelRef.current || globalBusy}
                      title={t.tipSetCurrentOrientation}
                    >
                      {t.setCurrentOrientation}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void resetVertexModelOrientation("model")}
                      disabled={
                        !baseModelRef.current ||
                        isIdentityOrientationMatrix(orientationMatrixRef.current) ||
                        globalBusy
                      }
                      title={t.tipResetOrientation}
                    >
                      {t.resetImportedOrientation}
                    </button>
                  </div>
                  <div className="muted note">
                    {t.orientationCurrent}: <b>{t.orientationCurrent}</b>
                  </div>
                </div>
              </section>
            )}

            {activeTab === "palette" && (
              <section className="card tab-card workflow-card">
                <h2>{t.paletteAndVirtualColours}</h2>
                <p className="muted workflow-intro">{t.paletteWorkflowIntro}</p>
                <div className="section-subtitle workflow-section-title">
                  {t.targetPaletteSettings}
                </div>
                {adjustmentsDirty && (
                  <div className="adjustment-note warning-note">
                    {t.paletteUsesAppliedColourAdjustment}
                  </div>
                )}
                <label className="inline-row" title={t.tipMaxColours}>
                  <HelpLabel title={t.tipMaxColours}>{t.maxColours}</HelpLabel>
                  <input
                    type="number"
                    min={1}
                    max={256}
                    value={pendingMaxColours}
                    onChange={(e) =>
                      setPendingMaxColours(Number(e.target.value))
                    }
                  />
                </label>
                <label className="inline-row" title={t.tipBlendStepPercent}>
                  <HelpLabel title={t.tipBlendStepPercent}>
                    {t.blendStepPercent}
                  </HelpLabel>
                  <select
                    value={pendingBlendStepPercent}
                    onChange={(e) =>
                      setPendingBlendStepPercent(
                        normalizeBlendStepPercent(
                          Number(e.target.value),
                          pendingBlendStepPercent,
                        ),
                      )
                    }
                  >
                    {BLEND_STEP_OPTIONS.map((step) => (
                      <option key={step} value={step}>
                        {blendRecipeResolutionLabel(step)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-row" title={t.tipAccentProtection}>
                  <HelpLabel title={t.tipAccentProtection}>
                    {t.accentProtection}
                  </HelpLabel>
                  <select
                    value={pendingAccentProtection}
                    onChange={(e) =>
                      setPendingAccentProtection(
                        isAccentProtectionMode(e.target.value)
                          ? e.target.value
                          : "off",
                      )
                    }
                  >
                    <option value="off">{t.accentProtectionOff}</option>
                    <option value="balanced">
                      {t.accentProtectionBalanced}
                    </option>
                    <option value="strong">{t.accentProtectionStrong}</option>
                  </select>
                </label>
                <label className="inline-row" title={t.tipVirtualMixPriority}>
                  <HelpLabel title={t.tipVirtualMixPriority}>
                    {t.virtualMixPriority}
                  </HelpLabel>
                  <select
                    value={pendingVirtualMixPriority}
                    onChange={(e) =>
                      setPendingVirtualMixPriority(
                        isVirtualMixPriorityMode(e.target.value)
                          ? e.target.value
                          : "accurate",
                      )
                    }
                  >
                    <option value="accurate">{t.mixPriorityAccurate}</option>
                    <option value="preserve-hue">
                      {t.mixPriorityPreserveHue}
                    </option>
                    <option value="avoid-muddy">
                      {t.mixPriorityAvoidMuddy}
                    </option>
                  </select>
                </label>

                <label className="inline-row" title={t.tipMappingStrategy}>
                  <HelpLabel title={t.tipMappingStrategy}>
                    {t.mappingStrategy}
                  </HelpLabel>
                  <select
                    value={pendingMappingStrategy}
                    onChange={(e) =>
                      setPendingMappingStrategy(
                        isMappingStrategyMode(e.target.value)
                          ? e.target.value
                          : "closest",
                      )
                    }
                  >
                    <option value="closest">{t.mappingClosest}</option>
                    <option value="smooth">{t.mappingSmooth}</option>
                    <option value="preserve-hue">{t.mappingHuePreserving}</option>
                    <option value="preserve-accent">
                      {t.mappingAccentPreserving}
                    </option>
                  </select>
                </label>
                <label
                  className="inline-row"
                  title={t.tipVirtualPreviewLightness}
                >
                  <HelpLabel title={t.tipVirtualPreviewLightness}>
                    {t.virtualPreviewLightness}
                  </HelpLabel>
                  <select
                    value={pendingVirtualPreviewLightness}
                    onChange={(e) =>
                      setPendingVirtualPreviewLightness(
                        normalizeVirtualPreviewLightness(e.target.value, 0),
                      )
                    }
                  >
                    <option value={-72}>
                      {t.virtualPreviewLightnessDarker}
                    </option>
                    <option value={-36}>
                      {t.virtualPreviewLightnessSlightlyDarker}
                    </option>
                    <option value={0}>
                      {t.virtualPreviewLightnessCalibrated}
                    </option>
                    <option value={12}>
                      {t.virtualPreviewLightnessSlightlyBrighter}
                    </option>
                  </select>
                </label>
                <div className="adjustment-actions">
                  <button
                    type="button"
                    onClick={handleApplyPaletteSettings}
                    disabled={!model || !paletteDirty || paletteApplyBusy}
                    title={t.tipApplyPaletteSettings}
                  >
                    {t.apply}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleResetPaletteSettings}
                    disabled={paletteApplyBusy}
                    title={t.tipResetPaletteSettings}
                  >
                    {t.reset}
                  </button>
                </div>
                {paletteDirty && !paletteApplyBusy && (
                  <div className="adjustment-note">
                    {t.unappliedPaletteChanges}
                  </div>
                )}
                <div className="section-subtitle blockmap-title workflow-section-title">
                  <HelpLabel title={t.tipPaletteBlockmap}>
                    {t.reducedTargetPalette}
                  </HelpLabel>
                </div>
                <PaletteBlockMap
                  entries={paletteBlockEntries}
                  emptyLabel={t.noPaletteYet}
                />
                <p className="muted small-note">
                  {palette.length > 0
                    ? `${palette.length} ${t.paletteColoursGenerated} · ${t.paletteSortedBySpectrum}`
                    : t.noPaletteYet}
                </p>

                <div
                  className="virtual-plan-box"
                  title={t.tipLayerSequencePlan}
                >
                  <div className="section-subtitle workflow-section-title">
                    {t.printableVirtualMixes}
                  </div>
                  <div className="section-subtitle">
                    <HelpLabel title={t.tipLayerSequencePlan}>
                      {t.layerSequencePlan}
                    </HelpLabel>
                  </div>
                  {palette.length > 0 && currentPhysicalSlots.length > 0 ? (
                    <>
                      <div className="stats compact-stats">
                        <div>
                          <span>{t.paletteColours}</span>
                          <b>{palette.length}</b>
                        </div>
                        <div>
                          <span>{t.virtualBlends}</span>
                          <b>{virtualExtruderPlan.virtualBlends.length}</b>
                        </div>
                        <div>
                          <span>{t.physicalOnlyColours}</span>
                          <b>{virtualExtruderPlan.physicalOnly.length}</b>
                        </div>
                      </div>
                      <div
                        className="stats compact-stats"
                        title={t.tipMappingDiagnostics}
                      >
                        <div>
                          <span>{t.averageMappingError}</span>
                          <b>{virtualExtruderPlan.mappingDiagnostics.averageError.toFixed(1)}</b>
                        </div>
                        <div>
                          <span>{t.worstMappingError}</span>
                          <b>{virtualExtruderPlan.mappingDiagnostics.worstError.toFixed(1)}</b>
                        </div>
                        <div>
                          <span>{t.poorMatches}</span>
                          <b>
                            {virtualExtruderPlan.mappingDiagnostics.poorMatchCount} / {virtualExtruderPlan.mappingDiagnostics.targetPaletteCount}
                          </b>
                        </div>
                        <div>
                          <span>{t.collapsedTargetColours}</span>
                          <b>{virtualExtruderPlan.mappingDiagnostics.collapsedTargetColours}</b>
                        </div>
                      </div>
                      <label
                        className="inline-row virtual-filter-row"
                        title={t.tipVirtualPlanFilter}
                      >
                        <HelpLabel title={t.tipVirtualPlanFilter}>
                          {t.virtualPlanFilter}
                        </HelpLabel>
                        <select
                          value={virtualPlanFilter}
                          onChange={(e) =>
                            setVirtualPlanFilter(
                              e.target.value as VirtualPlanFilter,
                            )
                          }
                        >
                          <option value="all">{t.filterAllAssignments}</option>
                          <option value="virtual">{t.filterVirtualOnly}</option>
                          <option value="physical">
                            {t.filterPhysicalOnly}
                          </option>
                          <option value="merged">{t.filterMergedOnly}</option>
                        </select>
                      </label>

                      <div
                        className="virtual-edit-box"
                        title={t.tipVirtualEdit}
                      >
                        <div className="section-subtitle">
                          <HelpLabel title={t.tipVirtualEdit}>
                            {t.virtualEditor}
                          </HelpLabel>
                        </div>
                        <div className="section-subtitle blockmap-title small-title">
                          <HelpLabel title={t.tipEffectiveMixBlockmap}>
                            {t.effectiveMixDistribution}
                          </HelpLabel>
                        </div>
                        <PaletteBlockMap
                          entries={effectiveColourBlockEntries}
                          onToggle={toggleAssignmentSelection}
                          emptyLabel={t.noLayerSequencePlan}
                        />
                        <div className="virtual-edit-actions stacked">
                          <div className="virtual-edit-selection-summary">
                            <b>{selectedPaletteIndices.length}</b>{" "}
                            {t.selectedPaletteColours}
                          </div>
                          <div className="virtual-edit-action-row">
                            <div>
                              <b>{t.mergeSelectedTitle}</b>
                              <p className="muted small-note">
                                {t.mergeSelectedDescription}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="secondary small-button"
                              disabled={
                                selectedPaletteIndices.length < 2 ||
                                virtualEditBusy
                              }
                              onClick={mergeSelectedVirtualAssignments}
                              title={t.tipMergeSelectedVirtuals}
                            >
                              {t.mergeSelected}
                            </button>
                          </div>
                          <div className="virtual-edit-action-row">
                            <div>
                              <b>{t.assignSelectedTitle}</b>
                              <p className="muted small-note">
                                {t.assignSelectedDescription}
                              </p>
                            </div>
                            <div className="assign-physical-controls">
                              <select
                                value={assignmentTargetExtruder}
                                onChange={(e) =>
                                  setAssignmentTargetExtruder(
                                    Number(e.target.value),
                                  )
                                }
                                title={t.tipAssignSelectedPhysical}
                                disabled={virtualEditBusy}
                              >
                                {Array.from(
                                  { length: physicalExtruders },
                                  (_, index) => (
                                    <option
                                      key={`assign-e-${index + 1}`}
                                      value={index + 1}
                                    >
                                      E{index + 1}
                                    </option>
                                  ),
                                )}
                              </select>
                              <button
                                type="button"
                                className="secondary small-button"
                                disabled={
                                  selectedPaletteIndices.length === 0 ||
                                  virtualEditBusy
                                }
                                onClick={assignSelectedToPhysicalExtruder}
                                title={t.tipAssignSelectedPhysical}
                              >
                                {t.assignSelectedToPhysical}
                              </button>
                            </div>
                          </div>
                          <div className="virtual-edit-action-row reset-row">
                            <div>
                              <b>{t.resetVirtualEdits}</b>
                              <p className="muted small-note">
                                {assignmentOverrideCount() > 0
                                  ? `${assignmentOverrideCount()} ${t.virtualEditOverridesActive}`
                                  : t.noVirtualEditOverrides}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="secondary small-button"
                              disabled={
                                assignmentOverrideCount() === 0 ||
                                virtualEditBusy
                              }
                              onClick={resetAssignmentOverrides}
                              title={t.tipResetVirtualEdits}
                            >
                              {t.reset}
                            </button>
                          </div>
                        </div>
                      </div>

                      {filteredVirtualBlends.length > 0 && (
                        <div className="virtual-plan-section">
                          <div className="virtual-plan-section-title">
                            {t.effectiveVirtualExtruders}
                          </div>
                          <div className="virtual-plan-list">
                            {filteredVirtualBlends.map((entry) => (
                              <div
                                className="virtual-plan-row virtual selectable"
                                key={entry.virtualId}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedAssignmentKeys.includes(
                                    `v:${entry.virtualId}`,
                                  )}
                                  onChange={() =>
                                    toggleAssignmentSelection(
                                      `v:${entry.virtualId}`,
                                    )
                                  }
                                  title={t.selectAssignmentRow}
                                />
                                <Swatch
                                  rgb={entry.displayRgb}
                                  title={`${entry.virtualId}: ${rgbToHex(entry.displayRgb)}`}
                                />
                                <b>VE{entry.virtualId}</b>
                                <VirtualComponentSummary entry={entry} />
                                <VirtualSequenceBar
                                  sequence={entry.sequence}
                                  slotRgbByNumber={physicalSlotRgbByNumber}
                                  title={virtualSequenceTitle(entry)}
                                />
                                <small
                                  title={paletteIndexTitle(
                                    entry.targetPaletteIndices,
                                  )}
                                >
                                  {entry.targetPaletteIndices.length > 1
                                    ? `${entry.targetPaletteIndices.length} ${t.mergedPaletteColours}: ${paletteIndexPreview(entry.targetPaletteIndices, 5)}`
                                    : `${t.paletteColour} #${entry.targetPaletteIndices[0]}`}
                                </small>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {filteredPhysicalOnly.length > 0 && (
                        <div className="virtual-plan-section">
                          <div className="virtual-plan-section-title">
                            {t.physicalDirectAssignments}
                          </div>
                          <div className="virtual-plan-list physical-only-list">
                            {filteredPhysicalOnly.map((entry) => (
                              <div
                                className="virtual-plan-row physical selectable"
                                key={`physical-${entry.physicalExtruder}-${entry.paletteIndex}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedAssignmentKeys.includes(
                                    `p:${entry.paletteIndex}`,
                                  )}
                                  onChange={() =>
                                    toggleAssignmentSelection(
                                      `p:${entry.paletteIndex}`,
                                    )
                                  }
                                  title={t.selectAssignmentRow}
                                />
                                <Swatch
                                  rgb={entry.physicalRgb}
                                  title={`E${entry.physicalExtruder}: ${paletteIndexPreview(entry.targetPaletteIndices, 8)} → ${rgbToHex(entry.physicalRgb)}`}
                                />
                                <b>E{entry.physicalExtruder}</b>
                                <span
                                  className="virtual-plan-components"
                                  title={`E${entry.physicalExtruder}: ${paletteIndexPreview(entry.targetPaletteIndices, 8)} → ${rgbToHex(entry.physicalRgb)}`}
                                >
                                  <span className="component-piece">
                                    <ExtruderBadge
                                      extruder={entry.physicalExtruder}
                                      rgb={entry.physicalRgb}
                                    />
                                    <span>100%</span>
                                  </span>
                                </span>
                                <VirtualSequenceBar
                                  sequence={[entry.physicalExtruder]}
                                  slotRgbByNumber={physicalSlotRgbByNumber}
                                  title={`E${entry.physicalExtruder} 100%`}
                                />
                                <small
                                  title={paletteIndexTitle(
                                    entry.targetPaletteIndices,
                                  )}
                                >
                                  {entry.targetPaletteIndices.length > 1
                                    ? `${entry.targetPaletteIndices.length} ${t.mergedPaletteColours}: ${paletteIndexPreview(entry.targetPaletteIndices, 5)}`
                                    : `${t.paletteColour} #${entry.targetPaletteIndices[0]}`}
                                </small>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {filteredVirtualBlends.length === 0 &&
                        filteredPhysicalOnly.length === 0 && (
                          <p className="muted">{t.noVirtualPlanRows}</p>
                        )}
                    </>
                  ) : (
                    <p className="muted">{t.noLayerSequencePlan}</p>
                  )}
                </div>
              </section>
            )}

            {activeTab === "template" && (
              <section className="card tab-card">
                <h2>{t.template3mf}</h2>
                <p className="muted">{t.templateIndependentNote}</p>
                <FileInputButton
                  label={t.chooseTemplate3mf}
                  accept=".3mf"
                  disabled={templateBusy}
                  onFile={onTemplateFile}
                />
                {templateInfo ? (
                  <div className="file-summary full">
                    <b>{templateInfo.fileName}</b>
                    <span>
                      {templateInfo.configFound
                        ? t.slic3rConfigFound
                        : t.slic3rConfigMissing}
                    </span>
                    <span>
                      {templateInfo.fullSpectrumFound
                        ? t.fullSpectrumFound
                        : t.fullSpectrumMissing}
                    </span>
                    <span>
                      {templateInfo.physicalColours.length}{" "}
                      {t.templateColoursFound}
                    </span>
                    {templateInfo.bedSize && (
                      <span>
                        {t.bedSize}: {templateInfo.bedSize.x.toFixed(0)} ×{" "}
                        {templateInfo.bedSize.y.toFixed(0)} mm
                      </span>
                    )}
                    <div className="palette-strip compact">
                      {templateInfo.physicalColours.map((rgb, i) => (
                        <Swatch
                          key={`${i}-${rgb.join(",")}`}
                          rgb={rgb}
                          title={`E${i + 1}: ${rgbToHex(rgb)}`}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="muted">{t.noTemplateLoaded}</p>
                )}
              </section>
            )}

            {activeTab === "physical" && (
              <section className="card tab-card workflow-card">
                <h2>{t.modelColourCorrection}</h2>
                <p className="muted workflow-intro">
                  {t.modelColourCorrectionIntro}
                </p>
                <div className="applied-summary">
                  <div className="section-subtitle">
                    {t.activeColourAdjustment}
                  </div>
                  <div className="summary-grid compact-summary-grid">
                    <span>
                      {t.brightness}: <b>{appliedAdjustments.brightness}</b>
                    </span>
                    <span>
                      {t.contrast}: <b>{appliedAdjustments.contrast}</b>
                    </span>
                    <span>
                      {t.saturation}: <b>{appliedAdjustments.saturation}</b>
                    </span>
                    <span>
                      {t.temperature}: <b>{appliedAdjustments.temperature}</b>
                    </span>
                    <span>
                      {t.hue}: <b>{appliedAdjustments.hue}</b>
                    </span>
                    <span>
                      {t.tint}: <b>{appliedAdjustments.tint}</b>
                    </span>
                    <span>
                      {t.gamma}: <b>{appliedAdjustments.gamma}</b>
                    </span>
                  </div>
                </div>
                <div className="section-subtitle workflow-section-title">
                  {t.prepareColourAdjustment}
                </div>
                <SliderRow
                  label={t.brightness}
                  tooltip={t.tipBrightness}
                  value={pendingAdjustments.brightness}
                  min={-100}
                  max={100}
                  step={1}
                  onChange={(v) => updatePendingAdjustment("brightness", v)}
                />
                <SliderRow
                  label={t.contrast}
                  tooltip={t.tipContrast}
                  value={pendingAdjustments.contrast}
                  min={-100}
                  max={100}
                  step={1}
                  onChange={(v) => updatePendingAdjustment("contrast", v)}
                />
                <SliderRow
                  label={t.saturation}
                  tooltip={t.tipSaturation}
                  value={pendingAdjustments.saturation}
                  min={-100}
                  max={100}
                  step={1}
                  onChange={(v) => updatePendingAdjustment("saturation", v)}
                />
                <SliderRow
                  label={t.temperature}
                  tooltip={t.tipTemperature}
                  value={pendingAdjustments.temperature}
                  min={-100}
                  max={100}
                  step={1}
                  onChange={(v) => updatePendingAdjustment("temperature", v)}
                />
                <SliderRow
                  label={t.hue}
                  tooltip={t.tipHue}
                  value={pendingAdjustments.hue}
                  min={-180}
                  max={180}
                  step={1}
                  gradient="hue"
                  onChange={(v) => updatePendingAdjustment("hue", v)}
                />
                <SliderRow
                  label={t.tint}
                  tooltip={t.tipTint}
                  value={pendingAdjustments.tint}
                  min={-100}
                  max={100}
                  step={1}
                  gradient="tint"
                  onChange={(v) => updatePendingAdjustment("tint", v)}
                />
                <SliderRow
                  label={t.gamma}
                  tooltip={t.tipGamma}
                  value={pendingAdjustments.gamma}
                  min={0.1}
                  max={3}
                  step={1}
                  onChange={(v) =>
                    updatePendingAdjustment("gamma", Number(v.toFixed(1)))
                  }
                />
                <div className="adjustment-actions">
                  <button
                    type="button"
                    onClick={handleApplyAdjustments}
                    disabled={!model || !adjustmentsDirty || colourApplyBusy}
                    title={t.tipApply}
                  >
                    {t.apply}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleResetPendingAdjustments}
                    disabled={colourApplyBusy}
                    title={t.tipResetAdjustments}
                  >
                    {t.reset}
                  </button>
                </div>
                {adjustmentsDirty && !colourApplyBusy && (
                  <div className="adjustment-note">
                    {t.unappliedColourChanges}
                  </div>
                )}
                {!adjustmentsDirty && model && (
                  <div className="workflow-hint">
                    {t.colourAdjustmentAppliedHint}
                  </div>
                )}
              </section>
            )}

            {activeTab === "physical" && (
              <section className="card tab-card workflow-card">
                <h2>{t.physicalColours}</h2>
                <p className="muted workflow-intro">
                  {t.physicalWorkflowIntro}
                </p>
                <div className="section-subtitle workflow-section-title">
                  {t.physicalDraftSection}
                </div>
                <label className="inline-row" title={t.tipPhysicalExtruders}>
                  <HelpLabel title={t.tipPhysicalExtruders}>
                    {t.physicalExtruders}
                  </HelpLabel>
                  <input
                    type="number"
                    min={3}
                    max={8}
                    value={pendingPhysicalExtruders}
                    onChange={(e) =>
                      handlePendingPhysicalExtruderCountChange(
                        Number(e.target.value),
                      )
                    }
                  />
                </label>
                <label className="inline-row" title={t.tipPhysicalColourSource}>
                  <HelpLabel title={t.tipPhysicalColourSource}>
                    {t.physicalColourSource}
                  </HelpLabel>
                  <select
                    value={pendingPhysicalColourSource}
                    onChange={(e) => {
                      setPendingPhysicalColourSource(
                        e.target.value as PhysicalColourSource,
                      );
                    }}
                  >
                    <option value="preset">{t.sourcePreset}</option>
                    <option value="template">{t.sourceTemplate}</option>
                    <option value="manual">{t.sourceManual}</option>
                    <option value="suggestion">{t.sourceSuggestion}</option>
                  </select>
                </label>

                {pendingPhysicalColourSource === "preset" && (
                  <>
                    <label
                      className="inline-row preset-row"
                      title={`${t.tipPresetBase}\n${pendingPresetDescription}`}
                    >
                      <HelpLabel
                        title={`${t.tipPresetBase}\n${pendingPresetDescription}`}
                      >
                        {pendingPhysicalExtruders > 5 ? t.presetBase : t.preset}
                      </HelpLabel>
                      <select
                        value={pendingPresetBaseName}
                        title={pendingPresetDescription}
                        onChange={(e) => {
                          const base = e.target.value;
                          if (pendingPhysicalExtruders > 5) {
                            setPendingPresetName(
                              presetNameForExtensionStrategy(
                                base,
                                pendingPhysicalExtruders,
                                pendingPresetExtensionStrategy,
                              ),
                            );
                          } else {
                            setPendingPresetName(base);
                          }
                        }}
                      >
                        {pendingPresetBaseChoices.map((name) => (
                          <option
                            key={name}
                            value={name}
                            title={presetFullDescription(name, t)}
                          >
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>

                    {pendingPhysicalExtruders > 5 && (
                      <label
                        className="inline-row preset-row"
                        title={`${t.tipPresetExtension}\n${pendingPresetDescription}`}
                      >
                        <HelpLabel
                          title={`${t.tipPresetExtension}\n${pendingPresetDescription}`}
                        >
                          {t.presetExtension}
                        </HelpLabel>
                        <select
                          value={pendingPresetExtensionStrategy}
                          title={pendingPresetDescription}
                          onChange={(e) => {
                            const group = e.target
                              .value as PresetExtensionGroup;
                            setPendingPresetName(
                              presetNameForExtensionStrategy(
                                pendingPresetBaseName,
                                pendingPhysicalExtruders,
                                group,
                              ),
                            );
                          }}
                        >
                          {pendingPresetExtensionStrategies.map((group) => {
                            const presetForGroup =
                              presetNameForExtensionStrategy(
                                pendingPresetBaseName,
                                pendingPhysicalExtruders,
                                group,
                              );
                            return (
                              <option
                                key={group}
                                value={group}
                                title={presetFullDescription(presetForGroup, t)}
                              >
                                {presetExtensionGroupLabel(group, t)}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    )}

                    {pendingPhysicalExtruders > 5 && (
                      <p className="muted info-note">{t.extendedPresetNote}</p>
                    )}
                    {pendingPresetTooSmall && (
                      <p className="muted warning">
                        {t.presetNotAvailableForExtruderCount}
                      </p>
                    )}
                    {pendingGreyscalePresetActive && (
                      <p className="muted info-note">{t.greyscalePresetNote}</p>
                    )}
                  </>
                )}

                {pendingPhysicalColourSource === "template" && (
                  <div className="source-box">
                    {templateInfo ? (
                      <p className="muted">{t.usingLoadedTemplateColours}</p>
                    ) : (
                      <p className="muted warning">{t.loadTemplateFirst}</p>
                    )}
                  </div>
                )}

                {pendingPhysicalColourSource === "manual" && (
                  <div className="source-box">
                    <textarea
                      className="hex-textarea"
                      value={pendingManualPhysicalColours}
                      onChange={(e) =>
                        setPendingManualPhysicalColours(e.target.value)
                      }
                      title={t.tipManualPhysicalColours}
                    />
                    <p className="muted">{t.manualColoursHelp}</p>
                  </div>
                )}

                {pendingPhysicalColourSource === "suggestion" && (
                  <div className="source-box">
                    {currentPhysicalSlots.length > 0 ? (
                      <p className="muted">{t.usingCalculatedSuggestion}</p>
                    ) : suggestionDraftComplete ? (
                      <p className="muted warning">
                        {t.applySuggestionDraftFirst}
                      </p>
                    ) : (
                      <p className="muted warning">
                        {t.calculateSuggestionFirst}
                      </p>
                    )}
                  </div>
                )}

                <div className="adjustment-actions">
                  <button
                    type="button"
                    onClick={handleApplyPhysicalSettings}
                    disabled={
                      !physicalSettingsDirty ||
                      pendingPresetTooSmall ||
                      globalBusy
                    }
                    title={t.tipApplyPhysicalSettings}
                  >
                    {t.apply}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleResetPendingPhysicalSettings}
                    disabled={!physicalSettingsDirty || globalBusy}
                    title={t.tipResetPhysicalSettings}
                  >
                    {t.reset}
                  </button>
                </div>
                {physicalSettingsDirty && (
                  <div className="adjustment-note">
                    {t.unappliedPhysicalSettings}
                  </div>
                )}
                {colourAdjustmentPresetNotice && (
                  <div className="adjustment-note warning-note">
                    {colourAdjustmentPresetNotice}
                  </div>
                )}

                <div className="physical-colour-preview">
                  <div className="section-subtitle">
                    {t.currentPhysicalColours} ·{" "}
                    {slotSourceLabel(physicalColourSource, t)}
                  </div>
                  {currentPhysicalSlots.length > 0 ? (
                    currentPhysicalSlots.map((s) => (
                      <div className="slot" key={s.slot}>
                        <span>E{s.slot}</span>
                        <Swatch rgb={s.filament.effectiveRgb} />
                        <b>{s.filament.name}</b>
                        <em>{rgbToHex(s.filament.effectiveRgb)}</em>
                      </div>
                    ))
                  ) : (
                    <p className="muted">{t.noPhysicalColoursYet}</p>
                  )}
                </div>
              </section>
            )}

            {activeTab === "physical" && (
              <section
                className={`card tab-card workflow-card${!filamentSuggestionEnabled ? " suggestion-locked" : ""}`}
              >
                <h2>{t.filamentSuggestion}</h2>
                <p className="muted">{t.filamentSuggestionCombinedNote}</p>
                {!filamentSuggestionEnabled && (
                  <p className="muted warning lock-note">
                    {t.filamentSuggestionLockedNote}
                  </p>
                )}
                {filamentListName ? (
                  <div className="file-summary full">
                    <b>{filamentListName}</b>
                    <span>
                      {loadedFilaments.length} {t.parsedFilaments}
                    </span>
                  </div>
                ) : (
                  <p className="muted warning">{t.loadFilamentListInLoadTab}</p>
                )}
                {loadedFilaments.length > 0 && (
                  <>
                    <label
                      className="inline-row"
                      title={
                        filamentSuggestionEnabled
                          ? t.tipSuggestionMode
                          : t.tipFilamentSuggestionLocked
                      }
                    >
                      <HelpLabel
                        title={
                          filamentSuggestionEnabled
                            ? t.tipSuggestionMode
                            : t.tipFilamentSuggestionLocked
                        }
                      >
                        {t.suggestionMode}
                      </HelpLabel>
                      <select
                        value={suggestionMode}
                        disabled={!filamentSuggestionEnabled}
                        onChange={(e) =>
                          handleSuggestionModeChange(
                            e.target.value as SuggestionMode,
                          )
                        }
                      >
                        <option value="balanced">{t.suggestionBalanced}</option>
                        <option value="dominant">{t.suggestionDominant}</option>
                        <option value="wide">{t.suggestionWide}</option>
                        <option value="expert">{t.suggestionExpert}</option>
                      </select>
                    </label>
                    {suggestionMode === "expert" && (
                      <div className="expert-box">
                        <div className="section-subtitle">
                          <HelpLabel
                            title={
                              filamentSuggestionEnabled
                                ? t.tipSuggestionExpert
                                : t.tipFilamentSuggestionLocked
                            }
                          >
                            {t.expertSettings}
                          </HelpLabel>
                        </div>
                        <SliderRow
                          label={t.saturationPenalty}
                          tooltip={
                            filamentSuggestionEnabled
                              ? t.tipSaturationPenalty
                              : t.tipFilamentSuggestionLocked
                          }
                          value={suggestionExpertSettings.saturationPenalty}
                          min={0}
                          max={1}
                          step={0.05}
                          disabled={!filamentSuggestionEnabled}
                          onChange={(v) =>
                            filamentSuggestionEnabled &&
                            setSuggestionExpertSettings((prev) => ({
                              ...prev,
                              saturationPenalty: Number(v.toFixed(2)),
                            }))
                          }
                        />
                        <SliderRow
                          label={t.diversityPenalty}
                          tooltip={
                            filamentSuggestionEnabled
                              ? t.tipDiversityPenalty
                              : t.tipFilamentSuggestionLocked
                          }
                          value={suggestionExpertSettings.diversityPenalty}
                          min={0}
                          max={1}
                          step={0.05}
                          disabled={!filamentSuggestionEnabled}
                          onChange={(v) =>
                            filamentSuggestionEnabled &&
                            setSuggestionExpertSettings((prev) => ({
                              ...prev,
                              diversityPenalty: Number(v.toFixed(2)),
                            }))
                          }
                        />
                        <SliderRow
                          label={t.balanceWeight}
                          tooltip={
                            filamentSuggestionEnabled
                              ? t.tipBalanceWeight
                              : t.tipFilamentSuggestionLocked
                          }
                          value={suggestionExpertSettings.balance}
                          min={0}
                          max={1}
                          step={0.05}
                          disabled={!filamentSuggestionEnabled}
                          onChange={(v) =>
                            filamentSuggestionEnabled &&
                            setSuggestionExpertSettings((prev) => ({
                              ...prev,
                              balance: Number(v.toFixed(2)),
                            }))
                          }
                        />
                        <SliderRow
                          label={t.weightExponent}
                          tooltip={
                            filamentSuggestionEnabled
                              ? t.tipWeightExponent
                              : t.tipFilamentSuggestionLocked
                          }
                          value={suggestionExpertSettings.weightExponent}
                          min={0}
                          max={1.2}
                          step={0.05}
                          disabled={!filamentSuggestionEnabled}
                          onChange={(v) =>
                            filamentSuggestionEnabled &&
                            setSuggestionExpertSettings((prev) => ({
                              ...prev,
                              weightExponent: Number(v.toFixed(2)),
                            }))
                          }
                        />
                        <SliderRow
                          label={t.neutralAnchor}
                          tooltip={
                            filamentSuggestionEnabled
                              ? t.tipNeutralAnchor
                              : t.tipFilamentSuggestionLocked
                          }
                          value={suggestionExpertSettings.neutralWeight}
                          min={0}
                          max={1}
                          step={0.05}
                          disabled={!filamentSuggestionEnabled}
                          onChange={(v) =>
                            filamentSuggestionEnabled &&
                            setSuggestionExpertSettings((prev) => ({
                              ...prev,
                              neutralWeight: Number(v.toFixed(2)),
                            }))
                          }
                        />
                        <label
                          className="inline-row"
                          title={
                            filamentSuggestionEnabled
                              ? t.tipSuggestionMaxComponents
                              : t.tipFilamentSuggestionLocked
                          }
                        >
                          <HelpLabel
                            title={
                              filamentSuggestionEnabled
                                ? t.tipSuggestionMaxComponents
                                : t.tipFilamentSuggestionLocked
                            }
                          >
                            {t.maxComponents}
                          </HelpLabel>
                          <select
                            value={suggestionExpertSettings.maxComponents}
                            disabled={!filamentSuggestionEnabled}
                            onChange={(e) =>
                              setSuggestionExpertSettings((prev) => ({
                                ...prev,
                                maxComponents: Number(e.target.value) as
                                  | 1
                                  | 2
                                  | 3,
                              }))
                            }
                          >
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                          </select>
                        </label>
                      </div>
                    )}
                    <div className="adjustment-actions suggestion-actions">
                      <button
                        type="button"
                        onClick={() => void makeSuggestion()}
                        disabled={
                          !filamentSuggestionEnabled ||
                          !model ||
                          palette.length === 0 ||
                          filteredFilaments.length === 0 ||
                          globalBusy
                        }
                        title={
                          filamentSuggestionEnabled
                            ? t.tipSuggestPhysicalColours
                            : t.tipFilamentSuggestionLocked
                        }
                      >
                        {t.suggest}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void applySuggestionDraft()}
                        disabled={!suggestionDraftReadyToApply || globalBusy}
                        title={
                          filamentSuggestionEnabled
                            ? t.tipApplySuggestionDraft
                            : t.tipFilamentSuggestionLocked
                        }
                      >
                        {t.applyDraft}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={resetSuggestionDraft}
                        disabled={
                          !filamentSuggestionEnabled ||
                          !suggestionDraftDirty ||
                          globalBusy
                        }
                        title={
                          filamentSuggestionEnabled
                            ? t.tipResetSuggestionDraft
                            : t.tipFilamentSuggestionLocked
                        }
                      >
                        {t.resetDraft}
                      </button>
                    </div>
                    {filamentSuggestionEnabled &&
                      missingSuggestionSlots.length > 0 && (
                        <div className="adjustment-note warning">
                          {t.suggestionDraftMissingSlots}:{" "}
                          {missingSuggestionSlots.join(", ")}
                        </div>
                      )}
                    {suggestionDraftReadyToApply && (
                      <div className="adjustment-note">
                        {t.unappliedSuggestionDraft}
                      </div>
                    )}
                    {filamentSuggestionEnabled &&
                      suggestionDraftComplete &&
                      !suggestionDraftDirty && (
                        <div className="muted small-note">
                          {t.suggestionDraftMatchesActive}
                        </div>
                      )}
                    <label
                      className="inline-row"
                      title={
                        filamentSuggestionEnabled
                          ? t.tipMaterialFilter
                          : t.tipFilamentSuggestionLocked
                      }
                    >
                      <HelpLabel
                        title={
                          filamentSuggestionEnabled
                            ? t.tipMaterialFilter
                            : t.tipFilamentSuggestionLocked
                        }
                      >
                        {t.materialFilter}
                      </HelpLabel>
                      <select
                        value={filamentMaterialFilter}
                        disabled={!filamentSuggestionEnabled}
                        onChange={(e) =>
                          handleMaterialFilterChange(e.target.value)
                        }
                      >
                        <option value="__all__">{t.allMaterials}</option>
                        {filamentMaterials.map((material) => (
                          <option key={material} value={material}>
                            {material === "__unknown__"
                              ? t.materialUnknown
                              : material}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="section-mini-title">
                      {t.draftSlotAssignment}
                    </div>
                    <p className="muted small-note">
                      {t.draftSlotAssignmentHelp}
                    </p>
                    <div
                      className="manual-slot-grid"
                      title={
                        filamentSuggestionEnabled
                          ? t.tipManualSlotGrid
                          : t.tipFilamentSuggestionLocked
                      }
                    >
                      {manualFilamentSlots.map((filament, index) => (
                        <div
                          className={`manual-slot-card${index === activeManualSlotIndex ? " active" : ""}${filament ? " filled" : ""}`}
                          key={`manual-slot-${index}`}
                        >
                          <button
                            type="button"
                            className="manual-slot-main"
                            onClick={() => setActiveManualSlotIndex(index)}
                            disabled={!filamentSuggestionEnabled}
                            title={
                              filamentSuggestionEnabled
                                ? t.tipSelectManualSlot
                                : t.tipFilamentSuggestionLocked
                            }
                          >
                            <span className="manual-slot-header">
                              <span className="manual-slot-label">
                                E{index + 1}
                              </span>
                              {filament ? (
                                <>
                                  <Swatch rgb={filament.effectiveRgb} />
                                  <code>{rgbToHex(filament.effectiveRgb)}</code>
                                </>
                              ) : null}
                            </span>
                            {filament ? (
                              <span className="manual-slot-name">
                                {filament.name}
                              </span>
                            ) : (
                              <span className="muted">{t.emptySlot}</span>
                            )}
                          </button>
                          <button
                            type="button"
                            className="secondary small-button manual-slot-clear"
                            onClick={() => clearManualFilamentSlot(index)}
                            disabled={!filamentSuggestionEnabled || !filament}
                            title={
                              filamentSuggestionEnabled
                                ? t.clearSlot
                                : t.tipFilamentSuggestionLocked
                            }
                          >
                            {t.clearSlot}
                          </button>
                        </div>
                      ))}
                    </div>
                    {manualSelectionOutsideFilterCount > 0 && (
                      <p className="muted warning">
                        {t.manualSelectionOutsideFilterWarning}
                      </p>
                    )}
                    <div className="filament-list-toolbar">
                      <span className="muted">
                        {filteredFilaments.length} / {loadedFilaments.length}{" "}
                        {t.parsedFilaments}
                      </span>
                      <span className="muted">
                        {t.manualSelection}: {manuallySelectedFilaments.length}{" "}
                        / {physicalExtruders}
                      </span>
                      <span className="muted">
                        {t.activeSlot}: E{activeManualSlotIndex + 1}
                      </span>
                      <button
                        type="button"
                        className="secondary small-button"
                        onClick={clearManualFilamentSelection}
                        disabled={
                          !filamentSuggestionEnabled ||
                          !manualFilamentSelectionKeys.some(Boolean) ||
                          globalBusy
                        }
                      >
                        {t.clearSelection}
                      </button>
                    </div>
                    <div
                      className="filament-table-wrap"
                      title={
                        filamentSuggestionEnabled
                          ? t.tipFilamentTable
                          : t.tipFilamentSuggestionLocked
                      }
                    >
                      <table className="filament-table">
                        <thead>
                          <tr>
                            <th>
                              <button
                                type="button"
                                onClick={() => changeFilamentSort("assign")}
                                disabled={!filamentSuggestionEnabled}
                              >
                                {t.assign}
                                {filamentSortKey === "assign"
                                  ? filamentSortDirection === "asc"
                                    ? " ▲"
                                    : " ▼"
                                  : ""}
                              </button>
                            </th>
                            <th>
                              <button
                                type="button"
                                onClick={() => changeFilamentSort("name")}
                                disabled={!filamentSuggestionEnabled}
                              >
                                {t.name}
                                {filamentSortKey === "name"
                                  ? filamentSortDirection === "asc"
                                    ? " ▲"
                                    : " ▼"
                                  : ""}
                              </button>
                            </th>
                            <th>
                              <button
                                type="button"
                                onClick={() => changeFilamentSort("material")}
                                disabled={!filamentSuggestionEnabled}
                              >
                                {t.material}
                                {filamentSortKey === "material"
                                  ? filamentSortDirection === "asc"
                                    ? " ▲"
                                    : " ▼"
                                  : ""}
                              </button>
                            </th>
                            <th>
                              <button
                                type="button"
                                onClick={() => changeFilamentSort("colour")}
                                disabled={!filamentSuggestionEnabled}
                                title={
                                  filamentSuggestionEnabled
                                    ? t.tipColourSpectrumSort
                                    : t.tipFilamentSuggestionLocked
                                }
                              >
                                {t.colour}
                                {filamentSortKey === "colour"
                                  ? filamentSortDirection === "asc"
                                    ? " ▲"
                                    : " ▼"
                                  : ""}
                              </button>
                            </th>
                            <th>{t.hexColour}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedFilteredFilaments.length > 0 ? (
                            sortedFilteredFilaments.map((filament) => {
                              const key = filamentKey(filament);
                              const assignedSlotIndex =
                                manualFilamentSelectionKeys.findIndex(
                                  (item) => item === key,
                                );
                              const selected = assignedSlotIndex >= 0;
                              return (
                                <tr
                                  key={key}
                                  className={selected ? "selected" : ""}
                                >
                                  <td>
                                    <button
                                      type="button"
                                      className="secondary small-button"
                                      onClick={() =>
                                        assignFilamentToManualSlot(filament)
                                      }
                                      disabled={!filamentSuggestionEnabled}
                                      title={
                                        filamentSuggestionEnabled
                                          ? t.tipAssignFilamentToActiveSlot
                                          : t.tipFilamentSuggestionLocked
                                      }
                                    >
                                      {selected
                                        ? `E${assignedSlotIndex + 1}`
                                        : `${t.assignToSlot} E${activeManualSlotIndex + 1}`}
                                    </button>
                                  </td>
                                  <td>{filament.name}</td>
                                  <td>{filamentMaterialLabel(filament, t)}</td>
                                  <td>
                                    <Swatch rgb={filament.effectiveRgb} />
                                  </td>
                                  <td>
                                    <code>
                                      {rgbToHex(filament.effectiveRgb)}
                                    </code>
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={5} className="muted">
                                {t.noFilamentsForFilter}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            )}

            {activeTab === "export" && (
              <section className="card tab-card export-card">
                <h2>{t.export}</h2>
                <p className="workflow-intro">{t.exportIntro}</p>
                <div className="section-subtitle">{t.export3mfProject}</div>
                <label className="inline-row" title={t.tipExportFileName}>
                  <HelpLabel title={t.tipExportFileName}>
                    {t.outputFileName}
                  </HelpLabel>
                  <input
                    className="text-input wide"
                    type="text"
                    value={exportFileName}
                    placeholder={
                      model
                        ? exportFileNameForModel(model.name)
                        : t.exportFileNamePlaceholder
                    }
                    onChange={(e) => {
                      exportFileNameUserEditedRef.current = true;
                      setExportFileName(e.target.value);
                    }}
                  />
                </label>
                <div className="file-summary full">
                  {templateInfo ? (
                    <>
                      <b>{templateInfo.fileName}</b>
                      <span>{t.exportUsesTemplate}</span>
                      {templateInfo.bedSize ? (
                        <span>
                          {t.bedSize}: {templateInfo.bedSize.x.toFixed(0)} ×{" "}
                          {templateInfo.bedSize.y.toFixed(0)} mm
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <b>{t.noTemplateLoaded}</b>
                      <span>{t.exportWithoutTemplateWarning}</span>
                    </>
                  )}
                </div>

                <div className="section-subtitle spaced">
                  {t.geometryAndBed}
                </div>
                <label className="inline-row" title={t.tipExportCoordinateMode}>
                  <HelpLabel title={t.tipExportCoordinateMode}>
                    {t.coordinateMode}
                  </HelpLabel>
                  <select
                    value={exportCoordinateMode}
                    onChange={(e) =>
                      setExportCoordinateMode(
                        e.target.value as ExportCoordinateMode,
                      )
                    }
                  >
                    <option value="auto">auto</option>
                    <option value="keep">keep</option>
                    <option value="blender-y-up">blender-y-up</option>
                  </select>
                </label>
                <label className="inline-row" title={t.tipExportScale}>
                  <HelpLabel title={t.tipExportScale}>{t.scale}</HelpLabel>
                  <input
                    type="text"
                    value={exportScale}
                    onChange={(e) => setExportScale(e.target.value)}
                  />
                </label>
                <label className="inline-row" title={t.tipExportTargetHeight}>
                  <HelpLabel title={t.tipExportTargetHeight}>
                    {t.targetHeight}
                  </HelpLabel>
                  <input
                    type="text"
                    placeholder={t.optional}
                    value={exportTargetHeight}
                    onChange={(e) => setExportTargetHeight(e.target.value)}
                  />
                </label>
                <label className="inline-check" title={t.tipExportPutOnBed}>
                  <input
                    type="checkbox"
                    checked={exportPutOnBed}
                    onChange={(e) => setExportPutOnBed(e.target.checked)}
                  />
                  {t.putOnBed}
                </label>
                <label className="inline-check" title={t.tipExportCenterOnBed}>
                  <input
                    type="checkbox"
                    checked={exportCenterOnBed}
                    onChange={(e) => setExportCenterOnBed(e.target.checked)}
                  />
                  {t.centerOnBed}
                </label>
                <label className="inline-row" title={t.tipExportBedSource}>
                  <HelpLabel title={t.tipExportBedSource}>
                    {t.bedSource}
                  </HelpLabel>
                  <select
                    value={exportBedSource}
                    onChange={(e) =>
                      setExportBedSource(e.target.value as ExportBedSource)
                    }
                    disabled={!exportCenterOnBed}
                  >
                    <option value="template">{t.fromTemplate}</option>
                    <option value="custom">{t.customBedSize}</option>
                  </select>
                </label>
                <div className="inline-row" title={t.tipExportBedSize}>
                  <HelpLabel title={t.tipExportBedSize}>{t.bedSize}</HelpLabel>
                  <span className="bed-size-inputs">
                    <input
                      type="text"
                      value={exportBedX}
                      onChange={(e) => setExportBedX(e.target.value)}
                      disabled={
                        !exportCenterOnBed || exportBedSource !== "custom"
                      }
                    />
                    <span>×</span>
                    <input
                      type="text"
                      value={exportBedY}
                      onChange={(e) => setExportBedY(e.target.value)}
                      disabled={
                        !exportCenterOnBed || exportBedSource !== "custom"
                      }
                    />
                    <span>mm</span>
                  </span>
                </div>
                <label
                  className="inline-row"
                  title={t.tipExportDefaultExtruder}
                >
                  <HelpLabel title={t.tipExportDefaultExtruder}>
                    {t.defaultExtruder}
                  </HelpLabel>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={exportDefaultExtruder}
                    onChange={(e) =>
                      setExportDefaultExtruder(Number(e.target.value))
                    }
                  />
                </label>

                <button
                  className="export-main-button"
                  disabled={
                    exportBusy ||
                    !model ||
                    palette.length === 0 ||
                    currentPhysicalSlots.length === 0 ||
                    adjustedColors.length === 0
                  }
                  onClick={handleExport3mf}
                  title={t.tipExport3mf}
                >
                  {exportBusy ? t.exporting3mf : t.export3mf}
                </button>

                <div className="section-subtitle spaced">{t.csvExports}</div>
                <div className="export-button-grid">
                  <button
                    disabled={palette.length === 0}
                    onClick={() =>
                      downloadText(
                        "palette.csv",
                        paletteToCsv(palette),
                        "text/csv;charset=utf-8",
                      )
                    }
                    title={t.tipDownloadPaletteCsv}
                  >
                    {t.downloadPaletteCsv}
                  </button>
                  <button
                    disabled={currentPhysicalSlots.length === 0}
                    onClick={() =>
                      downloadText(
                        "physical_colour_suggestion.csv",
                        slotsToCsv(currentPhysicalSlots),
                        "text/csv;charset=utf-8",
                      )
                    }
                    title={t.tipDownloadSuggestionCsv}
                  >
                    {t.downloadSuggestionCsv}
                  </button>
                  <button
                    disabled={
                      palette.length === 0 || currentPhysicalSlots.length === 0
                    }
                    onClick={() =>
                      downloadText(
                        "virtual_extruders_layer_sequences.csv",
                        virtualExtruderPlanToCsv(virtualExtruderPlan),
                        "text/csv;charset=utf-8",
                      )
                    }
                    title={t.tipDownloadVirtualExtruderCsv}
                  >
                    {t.downloadVirtualExtruderCsv}
                  </button>
                </div>
                <p className="muted note">{t.export3mfNote}</p>
              </section>
            )}

            {activeTab === "settings" && (
              <section className="card tab-card workflow-card">
                <h2>{t.settings}</h2>
                <p className="workflow-intro">{t.settingsIntro}</p>
                <div className="project-settings-grid">
                  <div className="project-settings-group">
                    <h3>{t.saveProjectContents}</h3>
                    {(
                      [
                        ["settings", t.projectPartSettings],
                        ["model", t.projectPartModel],
                        ["template", t.projectPartTemplate],
                        ["filamentList", t.projectPartFilamentList],
                      ] as Array<[ProjectPart, string]>
                    ).map(([part, label]) => (
                      <label
                        className="checkbox-row compact"
                        key={`save-${part}`}
                      >
                        <input
                          type="checkbox"
                          checked={saveProjectParts[part]}
                          onChange={(e) =>
                            updateProjectPartSelection(
                              "save",
                              part,
                              e.target.checked,
                            )
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="project-settings-group">
                    <h3>{t.loadProjectContents}</h3>
                    {(
                      [
                        ["settings", t.projectPartSettings],
                        ["model", t.projectPartModel],
                        ["template", t.projectPartTemplate],
                        ["filamentList", t.projectPartFilamentList],
                      ] as Array<[ProjectPart, string]>
                    ).map(([part, label]) => (
                      <label
                        className="checkbox-row compact"
                        key={`load-${part}`}
                      >
                        <input
                          type="checkbox"
                          checked={loadProjectParts[part]}
                          onChange={(e) =>
                            updateProjectPartSelection(
                              "load",
                              part,
                              e.target.checked,
                            )
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <p className="muted small-note">{t.projectSaveLoadNote}</p>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleSaveSettings}
                    title={t.tipSaveSettings}
                    disabled={settingsBusy}
                  >
                    {t.saveSettings}
                  </button>
                  <FileInputButton
                    label={t.loadSettings}
                    accept=".json,application/json"
                    disabled={settingsBusy}
                    onFile={onSettingsFile}
                  />
                </div>
              </section>
            )}
          </div>
        </aside>

        <div
          className="layout-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t.resizeSettingsPanel}
          title={t.resizeSettingsPanel}
          onPointerDown={handleSettingsResizePointerDown}
          onDoubleClick={handleSettingsResizeReset}
        />

        <section className="panel preview-panel">
          <div className="preview-surface-card">
            <div className="preview-toolbar preview-toolbar-merged">
              <div className="preview-toolbar-main">
                <div className="preview-control-row">
                  <label title={t.tipPreviewMode}>
                    <HelpLabel title={t.tipPreviewMode}>{t.mode}</HelpLabel>{" "}
                    <select
                      value={previewMode}
                      onChange={(e) =>
                        handlePreviewModeChange(e.target.value as PreviewMode)
                      }
                    >
                      <option value="adjusted">{t.adjusted}</option>
                      <option value="quantized">{t.quantized}</option>
                      <option value="print">{t.printSimulation}</option>
                    </select>
                  </label>
                  <label title={t.tipDisplayMode}>
                    <HelpLabel title={t.tipDisplayMode}>{t.display}</HelpLabel>{" "}
                    <select
                      value={previewDisplayMode}
                      onChange={(e) =>
                        handlePreviewDisplayModeChange(
                          e.target.value as PreviewDisplayMode,
                        )
                      }
                    >
                      <option value="shaded">{t.shaded}</option>
                      <option value="flat">{t.flatColour}</option>
                    </select>
                  </label>
                  <label title={t.tipBackground}>
                    <HelpLabel title={t.tipBackground}>
                      {t.background}
                    </HelpLabel>{" "}
                    <select
                      value={previewBackground}
                      onChange={(e) =>
                        handlePreviewBackgroundChange(
                          e.target.value as PreviewBackground,
                        )
                      }
                    >
                      <option value="auto">{t.previewBackgroundAuto}</option>
                      <option value="light">{t.light}</option>
                      <option value="dark">{t.dark}</option>
                    </select>
                  </label>

                  <>
                    <label title={t.tipView}>
                      <HelpLabel title={t.tipView}>{t.view}</HelpLabel>{" "}
                      <select
                        value={view}
                        disabled={!model || largeModelComputationsDeferred}
                        onChange={(e) => setView(e.target.value as View)}
                      >
                        <option value="front">{t.front}</option>
                        <option value="back">{t.back}</option>
                        <option value="left">{t.left}</option>
                        <option value="right">{t.right}</option>
                        <option value="top">{t.top}</option>
                        <option value="bottom">{t.bottom}</option>
                      </select>
                    </label>
                    <label title={t.tipWireframe}>
                      <input
                        type="checkbox"
                        checked={wireframe}
                        disabled={!model || largeModelComputationsDeferred}
                        onChange={(e) => {
                          setWireframe(e.target.checked);
                          startThreePreviewProgress();
                        }}
                      />
                      <HelpLabel title={t.tipWireframe}>
                        {t.wireframe}
                      </HelpLabel>
                    </label>
                    <label title={t.tipAxes}>
                      <input
                        type="checkbox"
                        checked={showAxes}
                        disabled={!model || largeModelComputationsDeferred}
                        onChange={(e) => setShowAxes(e.target.checked)}
                      />
                      <HelpLabel title={t.tipAxes}>{t.axes}</HelpLabel>
                    </label>
                    <label title={t.tipWebglPreviewLod}>
                      <HelpLabel title={t.tipWebglPreviewLod}>
                        {t.webglPreviewLod}
                      </HelpLabel>{" "}
                      <select
                        value={webglLodMode}
                        disabled={!model || largeModelComputationsDeferred}
                        onChange={(e) =>
                          setWebglLodMode(e.target.value as WebglLodMode)
                        }
                      >
                        <option value="off">{t.webglLodOff}</option>
                        <option value="tiny">{t.webglLodTiny}</option>
                        <option value="small">{t.webglLodSmall}</option>
                        <option value="medium">{t.webglLodMedium}</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary compact"
                      disabled={
                        !model ||
                        largeModelComputationsDeferred ||
                        !threePreviewActive
                      }
                      onClick={() => previewRef.current?.fitToModel()}
                      title={t.tipFitToModel}
                    >
                      {t.fitToModel}
                    </button>
                    <button
                      type="button"
                      className="secondary compact"
                      disabled={
                        !model ||
                        largeModelComputationsDeferred ||
                        !threePreviewActive
                      }
                      onClick={() => previewRef.current?.resetView(view)}
                      title={t.tipResetView}
                    >
                      {t.resetView}
                    </button>
                    <button
                      type="button"
                      className="secondary compact"
                      disabled={!model || largeModelComputationsDeferred}
                      onClick={handleRebuildPreview}
                      title={t.tipRebuildPreview}
                    >
                      {t.rebuildPreview}
                    </button>
                    {chromiumPreviewRisk && !chromiumPreviewBlocked ? (
                      <span className="preview-risk-note">
                        {t.chromiumPreviewWarning}
                      </span>
                    ) : null}
                  </>
                </div>
              </div>
            </div>

            <div className="preview-content-scroll">
              {largeModelComputationsDeferred && model ? (
                <section className="large-model-deferred-card">
                  <h2>{t.largeModelComputationsDeferredTitle}</h2>
                  <p>{t.largeModelComputationsDeferredText}</p>
                  <div className="preview-safety-stats">
                    <span>
                      {t.triangles}:{" "}
                      <b>{formatInt(model.stats.triangleCount)}</b>
                    </span>
                    <span>
                      {t.vertices}: <b>{formatInt(model.stats.vertexCount)}</b>
                    </span>
                    <span>
                      {t.uniqueFaceColours}:{" "}
                      <b>{formatInt(model.stats.uniqueFaceColors)}</b>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary danger-outline"
                    onClick={() => {
                      setLargeModelComputationsDeferred(false);
                      setStatus(t.largeModelComputationsStarted);
                      setActiveTab("physical");
                    }}
                  >
                    {t.startLargeModelComputations}
                  </button>
                </section>
              ) : chromiumPreviewBlocked && model ? (
                <div className="preview-safety-card">
                  <h3>{t.chromiumPreviewBlockedTitle}</h3>
                  <p>{t.chromiumPreviewBlockedText}</p>
                  <div className="preview-safety-stats">
                    <span>
                      {t.triangles}:{" "}
                      <b>{formatInt(model.stats.triangleCount)}</b>
                    </span>
                    <span>
                      {t.vertices}: <b>{formatInt(model.stats.vertexCount)}</b>
                    </span>
                    <span>
                      {t.uniqueFaceColours}:{" "}
                      <b>{formatInt(model.stats.uniqueFaceColors)}</b>
                    </span>
                    <span>
                      {t.previewSafetyThreshold}:{" "}
                      <b>{formatInt(CHROMIUM_PREVIEW_BLOCK_TRIANGLES)}</b>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary danger-outline"
                    onClick={() => setForceThreePreview(true)}
                  >
                    {t.load3dPreviewAnyway}
                  </button>
                </div>
              ) : (
                <section className="optional-three-card optional-three-card-fill">
                  <ThreePreview
                    key={previewResetKey}
                    ref={previewRef}
                    model={threePreviewActive ? modelForComputedPreview : null}
                    adjustedColors={adjustedColors}
                    previewMode={previewMode}
                    palette={palette}
                    effectivePaletteRgbByIndex={effectivePaletteRgbByIndex}
                    accentProtection={appliedAccentProtection}
                    view={view}
                    background={resolvedPreviewBackground}
                    displayMode={previewDisplayMode}
                    wireframe={wireframe}
                    showAxes={showAxes || showOrientationAxisGuide}
                    showAxisLabels={showOrientationAxisGuide}
                    lodMode={webglLodMode}
                    maxPreviewTriangles={MAX_WEBGL_PREVIEW_TRIANGLES}
                    onBusyChange={handlePreviewBusyChange}
                    emptyLabel={t.noModel}
                    busyLabel={t.buildingPreview}
                  />
                </section>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
