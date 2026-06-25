import * as THREE from "three";

export interface BakedColorEntry {
  hex: string;
  count: number;
  percent: number;
}

export interface ColorBlockEntry {
  hex: string;
  count: number;
  percent: number;
  span: number;
  isRemainder?: boolean;
}

export type SubdivisionMode = "off" | "adaptive";
export type BakeColorMode = "baseColor" | "baseColorEmissive" | "visibleExperimental";
export type SubdivisionQuality = "fast" | "medium" | "fine" | "veryFine" | "ultra" | "extreme" | "custom";
export type TopologyMode = "slicerSafe" | "adaptiveDetail";
export type ReliefSmoothing = "off" | "light" | "strong";
export type ReliefSource =
  | "none"
  | "displacementMap"
  | "bumpMap"
  | "aoMap"
  | "roughnessMap"
  | "metalnessMap";


export interface TextureColourCorrection {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  hue: number;
  tint: number;
  gamma: number;
}

export interface TextureBakeOptions {
  subdivisionMode?: SubdivisionMode;
  subdivisionQuality?: SubdivisionQuality;
  topologyMode?: TopologyMode;
  includePbrDetails?: boolean;
  maxColorError?: number;
  maxPbrError?: number;
  maxSubdivisionDepth?: number;
  triangleBudget?: number;
  balancedBaseDepth?: number;
  maxUvEdgePixels?: number;
  maxUvAreaPixels?: number;
  reliefEnabled?: boolean;
  reliefStrengthPercent?: number;
  reliefSmoothing?: ReliefSmoothing;
  reliefUsePbrProxy?: boolean;
  bakeColorMode?: BakeColorMode;
  textureMaxSize?: number | null;
  colourCorrection?: Partial<TextureColourCorrection>;
}

export interface TextureBakeReport {
  meshCount: number;
  triangleCount: number;
  bakedTriangles: number;
  outputTriangles: number;
  subdivisionMode: SubdivisionMode;
  subdivisionQuality: SubdivisionQuality;
  topologyMode: TopologyMode;
  subdivisionFactor: number;
  subdividedParentTriangles: number;
  colorTriggeredSubdivisions: number;
  pbrTriggeredSubdivisions: number;
  uvCoverageTriggeredSubdivisions: number;
  baseSubdividedParentTriangles: number;
  balancedBaseDepth: number;
  adaptivePasses: number;
  budgetSkippedSubdivisions: number;
  budgetLimitReached: boolean;
  maxDepthReached: number;
  avgColorDetailError: number;
  maxColorDetailError: number;
  avgPbrDetailError: number;
  maxPbrDetailError: number;
  avgUvEdgePixels: number;
  maxUvEdgePixels: number;
  avgUvAreaPixels: number;
  maxUvAreaPixels: number;
  texturedTriangles: number;
  materialFallbackTriangles: number;
  vertexColorFallbackTriangles: number;
  missingUvTriangles: number;
  missingMaterialTriangles: number;
  uniqueColors: number;
  topColors: BakedColorEntry[];
  colorBlocks: ColorBlockEntry[];
  colorBlockBinSize: number;
  colorBlockCoveragePercent: number;
  estimatedBakedGeometryBytes: number;
  reliefEnabled: boolean;
  reliefSource: ReliefSource;
  reliefStrengthPercent: number;
  reliefStrengthAbsolute: number;
  reliefSampledVertices: number;
  reliefAffectedVertices: number;
  reliefMeshesWithSource: number;
  reliefMissingSourceTriangles: number;
  reliefMinHeight: number;
  reliefMaxHeight: number;
  reliefAvgHeight: number;
  reliefMaxDisplacement: number;
  reliefSeamLockedVertices: number;
  bakedOpenEdges: number;
  bakedNonManifoldEdges: number;
  reliefUsePbrProxy: boolean;
  reliefConformingSubdivision: boolean;
  conformingSubdivision: boolean;
  bakeColorMode: BakeColorMode;
  textureMaxSize: number | null;
  originalTextureMaxSize: number;
  effectiveTextureMaxSize: number;
  warnings: string[];
}

type MaterialWithColorMap = THREE.Material & {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  opacity?: number;
  transparent?: boolean;
  roughness?: number;
  metalness?: number;
  normalMap?: THREE.Texture | null;
  bumpMap?: THREE.Texture | null;
  displacementMap?: THREE.Texture | null;
  displacementScale?: number;
  displacementBias?: number;
  roughnessMap?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  emissive?: THREE.Color;
  emissiveMap?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
};

interface SamplerData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  wrapS: THREE.Wrapping;
  wrapT: THREE.Wrapping;
  flipY: boolean;
  sourceWidth: number;
  sourceHeight: number;
}

interface SrgbColor {
  r: number;
  g: number;
  b: number;
}


function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normaliseColourCorrection(
  value?: Partial<TextureColourCorrection>,
): TextureColourCorrection {
  const src = value ?? {};
  const gamma = Number.isFinite(src.gamma) ? Number(src.gamma) : 1;
  return {
    brightness: Math.max(-100, Math.min(100, Number(src.brightness ?? 0))),
    contrast: Math.max(-100, Math.min(100, Number(src.contrast ?? 0))),
    saturation: Math.max(-100, Math.min(100, Number(src.saturation ?? 0))),
    temperature: Math.max(-100, Math.min(100, Number(src.temperature ?? 0))),
    hue: Math.max(-180, Math.min(180, Number(src.hue ?? 0))),
    tint: Math.max(-100, Math.min(100, Number(src.tint ?? 0))),
    gamma: Math.max(0.2, Math.min(3, gamma)),
  };
}

function hueToRgb(p: number, q: number, t: number): number {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
}

function rgbToHsl(color: SrgbColor): { h: number; s: number; l: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (Math.abs(max - min) < 1e-9) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb(hsl: { h: number; s: number; l: number }): SrgbColor {
  const h = ((hsl.h % 1) + 1) % 1;
  const s = clamp01(hsl.s);
  const l = clamp01(hsl.l);
  if (s <= 1e-9) {
    const v = clampByte(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: clampByte(hueToRgb(p, q, h + 1 / 3) * 255),
    g: clampByte(hueToRgb(p, q, h) * 255),
    b: clampByte(hueToRgb(p, q, h - 1 / 3) * 255),
  };
}

/**
 * Applies bake-time colour correction before colours are written to the baked
 * vertex/face-colour model. UV coordinates are intentionally untouched; only the
 * sampled material or texture colour is adjusted.
 */
export function applyTextureColourCorrection(
  input: SrgbColor,
  correction: TextureColourCorrection,
): SrgbColor {
  if (
    correction.brightness === 0 &&
    correction.contrast === 0 &&
    correction.saturation === 0 &&
    correction.temperature === 0 &&
    correction.hue === 0 &&
    correction.tint === 0 &&
    Math.abs(correction.gamma - 1) < 1e-9
  ) {
    return input;
  }

  let r = input.r / 255;
  let g = input.g / 255;
  let b = input.b / 255;

  if (Math.abs(correction.gamma - 1) > 1e-9) {
    const invGamma = 1 / correction.gamma;
    r = Math.pow(clamp01(r), invGamma);
    g = Math.pow(clamp01(g), invGamma);
    b = Math.pow(clamp01(b), invGamma);
  }

  const contrast = 1 + correction.contrast / 100;
  r = (r - 0.5) * contrast + 0.5;
  g = (g - 0.5) * contrast + 0.5;
  b = (b - 0.5) * contrast + 0.5;

  const brightness = correction.brightness / 100;
  r += brightness;
  g += brightness;
  b += brightness;

  r += correction.temperature / 500;
  b -= correction.temperature / 500;
  g += correction.tint / 700;
  r -= correction.tint / 1400;
  b -= correction.tint / 1400;

  let hsl = rgbToHsl({ r: clampByte(r * 255), g: clampByte(g * 255), b: clampByte(b * 255) });
  hsl.h = (hsl.h + correction.hue / 360) % 1;
  hsl.s = clamp01(hsl.s * (1 + correction.saturation / 100));
  return hslToRgb(hsl);
}

interface BakeVertex {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  uv: THREE.Vector2;
  hasUv: boolean;
  sourceIndex: number;
}

interface BakeTriangle {
  vertices: [BakeVertex, BakeVertex, BakeVertex];
  depth: number;
}

interface MaterialSamplingContext {
  material?: MaterialWithColorMap;
  baseSampler: SamplerData | null;
  normalSampler: SamplerData | null;
  bumpSampler: SamplerData | null;
  displacementSampler: SamplerData | null;
  roughnessSampler: SamplerData | null;
  metalnessSampler: SamplerData | null;
  aoSampler: SamplerData | null;
  emissiveSampler: SamplerData | null;
  alphaSampler: SamplerData | null;
}

interface DetailError {
  color: number;
  pbr: number;
  uvEdgePixels: number;
  uvAreaPixels: number;
}

interface ReliefPositionCacheEntry {
  position: THREE.Vector3;
  sampled: boolean;
  affected: boolean;
}

interface WorkTriangle extends BakeTriangle {
  ctx: MaterialSamplingContext;
  vertexColor: SrgbColor | null;
}

interface EvaluatedWorkTriangle {
  triangle: WorkTriangle;
  detail: DetailError;
  colorTooHigh: boolean;
  pbrTooHigh: boolean;
  uvCoverageTooHigh: boolean;
  score: number;
}

const DEFAULT_COLOR: SrgbColor = { r: 204, g: 214, b: 226 };
const RELIEF_POSITION_EPSILON = 1e-7;

const QUALITY_PRESETS: Record<
  Exclude<SubdivisionQuality, "custom">,
  {
    maxColorError: number;
    maxPbrError: number;
    maxSubdivisionDepth: number;
    triangleBudget: number;
    balancedBaseDepth: number;
    maxUvEdgePixels: number;
    maxUvAreaPixels: number;
  }
> = {
  fast: {
    maxColorError: 92,
    maxPbrError: 0.58,
    maxSubdivisionDepth: 3,
    triangleBudget: 500_000,
    balancedBaseDepth: 1,
    maxUvEdgePixels: 72,
    maxUvAreaPixels: 2800,
  },
  medium: {
    maxColorError: 58,
    maxPbrError: 0.36,
    maxSubdivisionDepth: 5,
    triangleBudget: 800_000,
    balancedBaseDepth: 2,
    maxUvEdgePixels: 42,
    maxUvAreaPixels: 1200,
  },
  fine: {
    maxColorError: 36,
    maxPbrError: 0.22,
    maxSubdivisionDepth: 7,
    triangleBudget: 1_500_000,
    balancedBaseDepth: 3,
    maxUvEdgePixels: 24,
    maxUvAreaPixels: 480,
  },
  veryFine: {
    maxColorError: 28,
    maxPbrError: 0.18,
    maxSubdivisionDepth: 8,
    triangleBudget: 2_000_000,
    balancedBaseDepth: 3,
    maxUvEdgePixels: 18,
    maxUvAreaPixels: 280,
  },
  ultra: {
    maxColorError: 28,
    maxPbrError: 0.18,
    maxSubdivisionDepth: 8,
    triangleBudget: 2_000_000,
    balancedBaseDepth: 3,
    maxUvEdgePixels: 18,
    maxUvAreaPixels: 280,
  },
  extreme: {
    maxColorError: 28,
    maxPbrError: 0.18,
    maxSubdivisionDepth: 8,
    triangleBudget: 2_000_000,
    balancedBaseDepth: 3,
    maxUvEdgePixels: 18,
    maxUvAreaPixels: 280,
  },
};

function presetForCustomBudget(budget: number | undefined) {
  const value = budget ?? QUALITY_PRESETS.medium.triangleBudget;
  if (value >= QUALITY_PRESETS.extreme.triangleBudget) return QUALITY_PRESETS.extreme;
  if (value >= QUALITY_PRESETS.ultra.triangleBudget) return QUALITY_PRESETS.ultra;
  if (value >= QUALITY_PRESETS.veryFine.triangleBudget) return QUALITY_PRESETS.veryFine;
  if (value >= QUALITY_PRESETS.fine.triangleBudget) return QUALITY_PRESETS.fine;
  if (value >= QUALITY_PRESETS.medium.triangleBudget) return QUALITY_PRESETS.medium;
  return QUALITY_PRESETS.fast;
}

function resolveOptions(
  options: TextureBakeOptions,
): Required<TextureBakeOptions> {
  const subdivisionQuality = options.subdivisionQuality ?? "medium";
  const preset =
    subdivisionQuality === "custom"
      ? presetForCustomBudget(options.triangleBudget)
      : QUALITY_PRESETS[subdivisionQuality];
  return {
    subdivisionMode: options.subdivisionMode ?? "off",
    subdivisionQuality,
    topologyMode: options.topologyMode ?? "slicerSafe",
    includePbrDetails: options.includePbrDetails ?? true,
    maxColorError: options.maxColorError ?? preset.maxColorError,
    maxPbrError: options.maxPbrError ?? preset.maxPbrError,
    maxSubdivisionDepth:
      Math.min(options.maxSubdivisionDepth ?? preset.maxSubdivisionDepth, 8),
    triangleBudget: options.triangleBudget ?? preset.triangleBudget,
    balancedBaseDepth: options.balancedBaseDepth ?? preset.balancedBaseDepth,
    maxUvEdgePixels: options.maxUvEdgePixels ?? preset.maxUvEdgePixels,
    maxUvAreaPixels: options.maxUvAreaPixels ?? preset.maxUvAreaPixels,
    reliefEnabled: options.reliefEnabled ?? false,
    reliefStrengthPercent: options.reliefStrengthPercent ?? 0.7,
    reliefSmoothing: options.reliefSmoothing ?? "light",
    reliefUsePbrProxy: options.reliefUsePbrProxy ?? true,
    bakeColorMode: options.bakeColorMode ?? "baseColor",
    textureMaxSize: options.textureMaxSize ?? null,
    colourCorrection: normaliseColourCorrection(options.colourCorrection),
  };
}

function toMaterialArray(
  material: THREE.Material | THREE.Material[] | undefined,
): THREE.Material[] {
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh;
}

function getIndexAt(
  index: THREE.BufferAttribute | null,
  triangleStart: number,
  offset: number,
): number {
  return index ? index.getX(triangleStart + offset) : triangleStart + offset;
}

function quantizePositionComponent(
  value: number,
  epsilon = RELIEF_POSITION_EPSILON,
): string {
  if (!Number.isFinite(value)) return "nan";
  return String(Math.round(value / epsilon));
}

function reliefPositionKey(position: THREE.Vector3): string {
  return [
    quantizePositionComponent(position.x),
    quantizePositionComponent(position.y),
    quantizePositionComponent(position.z),
  ].join("|");
}

function sortedEdgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function topologyDiagnosticsFromNonIndexedPositions(positions: number[]): {
  openEdges: number;
  nonManifoldEdges: number;
} {
  const edgeCounts = new Map<string, number>();
  const triangleStride = 9;
  for (
    let offset = 0;
    offset + 8 < positions.length;
    offset += triangleStride
  ) {
    const keys = [0, 1, 2].map((vertexOffset) => {
      const base = offset + vertexOffset * 3;
      return [
        quantizePositionComponent(positions[base]),
        quantizePositionComponent(positions[base + 1]),
        quantizePositionComponent(positions[base + 2]),
      ].join("|");
    });
    const edges: Array<[string, string]> = [
      [keys[0], keys[1]],
      [keys[1], keys[2]],
      [keys[2], keys[0]],
    ];
    for (const [a, b] of edges) {
      const key = sortedEdgeKey(a, b);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) openEdges += 1;
    if (count > 2) nonManifoldEdges += 1;
  }
  return { openEdges, nonManifoldEdges };
}

function normalizeWrap(value: number, wrapping: THREE.Wrapping): number {
  if (wrapping === THREE.RepeatWrapping) {
    return ((value % 1) + 1) % 1;
  }

  if (wrapping === THREE.MirroredRepeatWrapping) {
    const repeated = ((value % 2) + 2) % 2;
    return repeated <= 1 ? repeated : 2 - repeated;
  }

  return THREE.MathUtils.clamp(value, 0, 1);
}

function srgbToHex(color: SrgbColor): string {
  const r = THREE.MathUtils.clamp(Math.round(color.r), 0, 255);
  const g = THREE.MathUtils.clamp(Math.round(color.g), 0, 255);
  const b = THREE.MathUtils.clamp(Math.round(color.b), 0, 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

function quantizedColorKey(color: SrgbColor, binSize: number): string {
  const channel = (value: number) =>
    THREE.MathUtils.clamp(
      Math.floor(value / binSize),
      0,
      Math.ceil(256 / binSize) - 1,
    );
  return `${channel(color.r)}:${channel(color.g)}:${channel(color.b)}`;
}

function colorBlockSpan(percent: number): number {
  if (percent >= 12) return 5;
  if (percent >= 7) return 4;
  if (percent >= 3.5) return 3;
  if (percent >= 1.2) return 2;
  return 1;
}

function srgbToLinearFloats(color: SrgbColor): [number, number, number] {
  const threeColor = new THREE.Color(
    color.r / 255,
    color.g / 255,
    color.b / 255,
  );
  threeColor.convertSRGBToLinear();
  return [threeColor.r, threeColor.g, threeColor.b];
}

function materialBaseColor(material: THREE.Material | undefined): SrgbColor {
  const mat = material as MaterialWithColorMap | undefined;
  if (!mat?.color) return { ...DEFAULT_COLOR };

  const color = mat.color.clone();
  color.convertLinearToSRGB();
  return {
    r: THREE.MathUtils.clamp(Math.round(color.r * 255), 0, 255),
    g: THREE.MathUtils.clamp(Math.round(color.g * 255), 0, 255),
    b: THREE.MathUtils.clamp(Math.round(color.b * 255), 0, 255),
  };
}

function materialEmissiveColor(material: THREE.Material | undefined): SrgbColor {
  const mat = material as MaterialWithColorMap | undefined;
  if (!mat?.emissive) return { r: 0, g: 0, b: 0 };
  const color = mat.emissive.clone();
  color.convertLinearToSRGB();
  return {
    r: THREE.MathUtils.clamp(Math.round(color.r * 255), 0, 255),
    g: THREE.MathUtils.clamp(Math.round(color.g * 255), 0, 255),
    b: THREE.MathUtils.clamp(Math.round(color.b * 255), 0, 255),
  };
}

function addColorsClamped(a: SrgbColor, b: SrgbColor, weight = 1): SrgbColor {
  return {
    r: THREE.MathUtils.clamp(a.r + b.r * weight, 0, 255),
    g: THREE.MathUtils.clamp(a.g + b.g * weight, 0, 255),
    b: THREE.MathUtils.clamp(a.b + b.b * weight, 0, 255),
  };
}

function multiplyColors(a: SrgbColor, b: SrgbColor): SrgbColor {
  return {
    r: (a.r * b.r) / 255,
    g: (a.g * b.g) / 255,
    b: (a.b * b.b) / 255,
  };
}

function vertexColorAt(
  colors: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  a: number,
  b: number,
  c: number,
): SrgbColor {
  const r = (colors.getX(a) + colors.getX(b) + colors.getX(c)) / 3;
  const g = (colors.getY(a) + colors.getY(b) + colors.getY(c)) / 3;
  const blue = (colors.getZ(a) + colors.getZ(b) + colors.getZ(c)) / 3;

  const color = new THREE.Color(r, g, blue);
  color.convertLinearToSRGB();
  return {
    r: THREE.MathUtils.clamp(Math.round(color.r * 255), 0, 255),
    g: THREE.MathUtils.clamp(Math.round(color.g * 255), 0, 255),
    b: THREE.MathUtils.clamp(Math.round(color.b * 255), 0, 255),
  };
}

function getTextureSampler(
  texture: THREE.Texture | null | undefined,
  cache: Map<THREE.Texture, SamplerData>,
  maxSize: number | null,
): SamplerData | null {
  if (!texture) return null;
  const cached = cache.get(texture);
  if (cached) return cached;

  const image = texture.image as
    | (CanvasImageSource & {
        width?: number;
        height?: number;
        naturalWidth?: number;
        naturalHeight?: number;
      })
    | undefined;
  const sourceWidth = Math.max(
    1,
    Math.round(image?.width ?? image?.naturalWidth ?? 0),
  );
  const sourceHeight = Math.max(
    1,
    Math.round(image?.height ?? image?.naturalHeight ?? 0),
  );
  if (!image || sourceWidth <= 1 || sourceHeight <= 1) return null;

  const limit = maxSize && maxSize > 0 ? maxSize : Math.max(sourceWidth, sourceHeight);
  const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  try {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const sampler: SamplerData = {
      width,
      height,
      data: imageData.data,
      wrapS: texture.wrapS,
      wrapT: texture.wrapT,
      flipY: texture.flipY,
      sourceWidth,
      sourceHeight,
    };
    cache.set(texture, sampler);
    return sampler;
  } catch {
    return null;
  }
}

function sampleTexturePixel(
  sampler: SamplerData,
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number } {
  const px = THREE.MathUtils.clamp(x, 0, sampler.width - 1);
  const py = THREE.MathUtils.clamp(y, 0, sampler.height - 1);
  const offset = (py * sampler.width + px) * 4;
  return {
    r: sampler.data[offset],
    g: sampler.data[offset + 1],
    b: sampler.data[offset + 2],
    a: sampler.data[offset + 3] / 255,
  };
}

function sampleTexture(sampler: SamplerData, u: number, v: number): SrgbColor {
  const wrappedU = normalizeWrap(u, sampler.wrapS);
  const wrappedV = normalizeWrap(v, sampler.wrapT);
  const yUv = sampler.flipY ? 1 - wrappedV : wrappedV;

  const x = THREE.MathUtils.clamp(
    wrappedU * (sampler.width - 1),
    0,
    sampler.width - 1,
  );
  const y = THREE.MathUtils.clamp(
    yUv * (sampler.height - 1),
    0,
    sampler.height - 1,
  );
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, sampler.width - 1);
  const y1 = Math.min(y0 + 1, sampler.height - 1);
  const tx = x - x0;
  const ty = y - y0;

  const p00 = sampleTexturePixel(sampler, x0, y0);
  const p10 = sampleTexturePixel(sampler, x1, y0);
  const p01 = sampleTexturePixel(sampler, x0, y1);
  const p11 = sampleTexturePixel(sampler, x1, y1);

  const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
  const top = {
    r: mix(p00.r, p10.r, tx),
    g: mix(p00.g, p10.g, tx),
    b: mix(p00.b, p10.b, tx),
    a: mix(p00.a, p10.a, tx),
  };
  const bottom = {
    r: mix(p01.r, p11.r, tx),
    g: mix(p01.g, p11.g, tx),
    b: mix(p01.b, p11.b, tx),
    a: mix(p01.a, p11.a, tx),
  };
  const raw = {
    r: mix(top.r, bottom.r, ty),
    g: mix(top.g, bottom.g, ty),
    b: mix(top.b, bottom.b, ty),
    a: mix(top.a, bottom.a, ty),
  };

  if (raw.a >= 0.999) return { r: raw.r, g: raw.g, b: raw.b };

  return {
    r: raw.r * raw.a + 255 * (1 - raw.a),
    g: raw.g * raw.a + 255 * (1 - raw.a),
    b: raw.b * raw.a + 255 * (1 - raw.a),
  };
}

function sampleTextureChannel(
  sampler: SamplerData,
  u: number,
  v: number,
  channel: "r" | "g" | "b" | "luminance",
): number {
  const color = sampleTexture(sampler, u, v);
  if (channel === "r") return color.r / 255;
  if (channel === "g") return color.g / 255;
  if (channel === "b") return color.b / 255;
  return luminance(color);
}

function pbrProxyHeightFromContext(
  ctx: MaterialSamplingContext,
  uv: THREE.Vector2,
  smoothing: ReliefSmoothing,
): number | null {
  const sampler = ctx.aoSampler ?? ctx.roughnessSampler ?? ctx.metalnessSampler;
  if (!sampler) return null;
  const offsets: Array<[number, number, number]> =
    smoothing === "off"
      ? [[0, 0, 1]]
      : smoothing === "light"
        ? [
            [0, 0, 4],
            [1, 0, 1],
            [-1, 0, 1],
            [0, 1, 1],
            [0, -1, 1],
          ]
        : [
            [0, 0, 4],
            [1, 0, 2],
            [-1, 0, 2],
            [0, 1, 2],
            [0, -1, 2],
            [1, 1, 1],
            [-1, 1, 1],
            [1, -1, 1],
            [-1, -1, 1],
          ];
  const du = 1 / Math.max(1, sampler.width);
  const dv = 1 / Math.max(1, sampler.height);
  let total = 0;
  let weight = 0;
  for (const [ox, oy, w] of offsets) {
    const sampleU = uv.x + ox * du;
    const sampleV = uv.y + oy * dv;
    let value: number;
    if (ctx.aoSampler) {
      value = sampleTextureChannel(ctx.aoSampler, sampleU, sampleV, "r");
    } else if (ctx.roughnessSampler) {
      value = sampleTextureChannel(ctx.roughnessSampler, sampleU, sampleV, "g");
    } else {
      value = sampleTextureChannel(
        ctx.metalnessSampler!,
        sampleU,
        sampleV,
        "b",
      );
    }
    total += value * w;
    weight += w;
  }
  return weight > 0 ? total / weight : null;
}

function reliefSourceForContext(
  ctx: MaterialSamplingContext,
  allowPbrProxy: boolean,
): { source: ReliefSource; sampler: SamplerData | null } {
  if (ctx.displacementSampler)
    return { source: "displacementMap", sampler: ctx.displacementSampler };
  if (ctx.bumpSampler) return { source: "bumpMap", sampler: ctx.bumpSampler };
  if (!allowPbrProxy) return { source: "none", sampler: null };
  if (ctx.aoSampler) return { source: "aoMap", sampler: ctx.aoSampler };
  if (ctx.roughnessSampler)
    return { source: "roughnessMap", sampler: ctx.roughnessSampler };
  if (ctx.metalnessSampler)
    return { source: "metalnessMap", sampler: ctx.metalnessSampler };
  return { source: "none", sampler: null };
}

function reliefSourcePriority(source: ReliefSource): number {
  switch (source) {
    case "displacementMap":
      return 5;
    case "bumpMap":
      return 4;
    case "aoMap":
      return 3;
    case "roughnessMap":
      return 2;
    case "metalnessMap":
      return 1;
    default:
      return 0;
  }
}

function heightFromReliefSource(
  ctx: MaterialSamplingContext,
  source: ReliefSource,
  sampler: SamplerData,
  uv: THREE.Vector2,
  smoothing: ReliefSmoothing,
): number {
  if (
    source === "aoMap" ||
    source === "roughnessMap" ||
    source === "metalnessMap"
  ) {
    const proxy = pbrProxyHeightFromContext(ctx, uv, smoothing);
    return proxy ?? 0.5;
  }
  return heightFromSampler(sampler, uv, smoothing);
}

function heightFromSampler(
  sampler: SamplerData,
  uv: THREE.Vector2,
  smoothing: ReliefSmoothing,
): number {
  const offsets: Array<[number, number, number]> =
    smoothing === "off"
      ? [[0, 0, 1]]
      : smoothing === "light"
        ? [
            [0, 0, 4],
            [1, 0, 1],
            [-1, 0, 1],
            [0, 1, 1],
            [0, -1, 1],
          ]
        : [
            [0, 0, 4],
            [1, 0, 2],
            [-1, 0, 2],
            [0, 1, 2],
            [0, -1, 2],
            [1, 1, 1],
            [-1, 1, 1],
            [1, -1, 1],
            [-1, -1, 1],
          ];

  let total = 0;
  let weight = 0;
  const du = 1 / Math.max(1, sampler.width);
  const dv = 1 / Math.max(1, sampler.height);
  for (const [ox, oy, w] of offsets) {
    total +=
      luminance(sampleTexture(sampler, uv.x + ox * du, uv.y + oy * dv)) * w;
    weight += w;
  }
  return weight > 0
    ? total / weight
    : luminance(sampleTexture(sampler, uv.x, uv.y));
}

function colorDistance(a: SrgbColor, b: SrgbColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function luminance(color: SrgbColor): number {
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
}

function normalVectorDelta(a: SrgbColor, b: SrgbColor): number {
  const ax = a.r / 127.5 - 1;
  const ay = a.g / 127.5 - 1;
  const az = a.b / 127.5 - 1;
  const bx = b.r / 127.5 - 1;
  const by = b.g / 127.5 - 1;
  const bz = b.b / 127.5 - 1;
  const dot = THREE.MathUtils.clamp(ax * bx + ay * by + az * bz, -1, 1);
  return Math.acos(dot) / Math.PI;
}

function maxPairwiseColorDistance(colors: SrgbColor[]): number {
  let max = 0;
  for (let i = 0; i < colors.length; i += 1) {
    for (let j = i + 1; j < colors.length; j += 1) {
      max = Math.max(max, colorDistance(colors[i], colors[j]));
    }
  }
  return max;
}

function maxPairwiseScalarDistance(values: number[]): number {
  if (values.length < 2) return 0;
  return Math.max(...values) - Math.min(...values);
}

function materialIndexForTriangle(
  geometry: THREE.BufferGeometry,
  triangleElementStart: number,
): number {
  if (!geometry.groups.length) return 0;
  const group = geometry.groups.find(
    (entry) =>
      triangleElementStart >= entry.start &&
      triangleElementStart < entry.start + entry.count,
  );
  return group?.materialIndex ?? 0;
}

function readVector3(
  attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  index: number,
  fallback: THREE.Vector3,
): THREE.Vector3 {
  if (!attr) return fallback.clone();
  return new THREE.Vector3(
    attr.getX(index),
    attr.getY(index),
    attr.getZ(index),
  );
}

function readVector2(
  attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  index: number,
): THREE.Vector2 {
  if (!attr) return new THREE.Vector2(0, 0);
  return new THREE.Vector2(attr.getX(index), attr.getY(index));
}

function pushBakeVertex(
  targetPositions: number[],
  targetNormals: number[],
  targetUvs: number[],
  vertex: BakeVertex,
): void {
  targetPositions.push(vertex.position.x, vertex.position.y, vertex.position.z);
  targetNormals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
  targetUvs.push(vertex.uv.x, vertex.uv.y);
}

function createBakedMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

function midVertex(a: BakeVertex, b: BakeVertex): BakeVertex {
  return {
    position: a.position.clone().add(b.position).multiplyScalar(0.5),
    normal: a.normal.clone().add(b.normal).normalize(),
    uv: a.uv.clone().add(b.uv).multiplyScalar(0.5),
    hasUv: a.hasUv && b.hasUv,
    sourceIndex: a.sourceIndex,
  };
}

function triangleCenterUv(triangle: BakeTriangle): THREE.Vector2 {
  return triangle.vertices[0].uv
    .clone()
    .add(triangle.vertices[1].uv)
    .add(triangle.vertices[2].uv)
    .multiplyScalar(1 / 3);
}

function sampleBarycentricUv(
  triangle: BakeTriangle,
  a: number,
  b: number,
  c: number,
): THREE.Vector2 {
  return new THREE.Vector2(
    triangle.vertices[0].uv.x * a +
      triangle.vertices[1].uv.x * b +
      triangle.vertices[2].uv.x * c,
    triangle.vertices[0].uv.y * a +
      triangle.vertices[1].uv.y * b +
      triangle.vertices[2].uv.y * c,
  );
}

function textureColorAt(
  ctx: MaterialSamplingContext,
  uv: THREE.Vector2,
  mode: BakeColorMode,
): SrgbColor {
  const base = ctx.baseSampler
    ? multiplyColors(sampleTexture(ctx.baseSampler, uv.x, uv.y), materialBaseColor(ctx.material))
    : materialBaseColor(ctx.material);

  if (mode === "baseColor") return base;

  const emissiveBase = materialEmissiveColor(ctx.material);
  const emissive = ctx.emissiveSampler
    ? multiplyColors(sampleTexture(ctx.emissiveSampler, uv.x, uv.y), emissiveBase)
    : emissiveBase;
  let color = addColorsClamped(base, emissive, mode === "visibleExperimental" ? 1.0 : 0.85);

  if (mode === "visibleExperimental" && ctx.alphaSampler) {
    const alpha = sampleTexture(ctx.alphaSampler, uv.x, uv.y);
    const alphaValue = Math.max(alpha.r, alpha.g, alpha.b) / 255;
    const fallback = materialBaseColor(ctx.material);
    color = {
      r: color.r * alphaValue + fallback.r * (1 - alphaValue),
      g: color.g * alphaValue + fallback.g * (1 - alphaValue),
      b: color.b * alphaValue + fallback.b * (1 - alphaValue),
    };
  }

  return color;
}

function detailSampleUvs(triangle: BakeTriangle): THREE.Vector2[] {
  return [
    sampleBarycentricUv(triangle, 0.72, 0.14, 0.14),
    sampleBarycentricUv(triangle, 0.14, 0.72, 0.14),
    sampleBarycentricUv(triangle, 0.14, 0.14, 0.72),
    triangleCenterUv(triangle),
    sampleBarycentricUv(triangle, 0.48, 0.26, 0.26),
    sampleBarycentricUv(triangle, 0.26, 0.48, 0.26),
    sampleBarycentricUv(triangle, 0.26, 0.26, 0.48),
  ];
}

function averageSrgbColors(colors: SrgbColor[]): SrgbColor {
  if (colors.length === 0) return { ...DEFAULT_COLOR };
  const sum = colors.reduce(
    (acc, color) => ({
      r: acc.r + color.r,
      g: acc.g + color.g,
      b: acc.b + color.b,
    }),
    { r: 0, g: 0, b: 0 },
  );
  return {
    r: sum.r / colors.length,
    g: sum.g / colors.length,
    b: sum.b / colors.length,
  };
}

function representativeTextureColorForTriangle(
  ctx: MaterialSamplingContext,
  triangle: BakeTriangle,
  mode: BakeColorMode,
): SrgbColor {
  const hasAnyColorSampler = Boolean(ctx.baseSampler || ctx.emissiveSampler);
  if (!hasAnyColorSampler || !triangle.vertices.every((vertex) => vertex.hasUv))
    return materialBaseColor(ctx.material);
  const samples = detailSampleUvs(triangle).map((uv) =>
    textureColorAt(ctx, uv, mode),
  );
  return averageSrgbColors(samples);
}

function detailSamplerForCoverage(
  ctx: MaterialSamplingContext,
): SamplerData | null {
  return (
    ctx.baseSampler ??
    ctx.displacementSampler ??
    ctx.normalSampler ??
    ctx.bumpSampler ??
    ctx.roughnessSampler ??
    ctx.aoSampler ??
    ctx.metalnessSampler
  );
}

function uvCoverageInPixels(
  triangle: BakeTriangle,
  ctx: MaterialSamplingContext,
): { edgePixels: number; areaPixels: number } {
  if (!triangle.vertices.every((vertex) => vertex.hasUv))
    return { edgePixels: 0, areaPixels: 0 };
  const sampler = detailSamplerForCoverage(ctx);
  if (!sampler) return { edgePixels: 0, areaPixels: 0 };

  const points = triangle.vertices.map(
    (vertex) =>
      new THREE.Vector2(
        vertex.uv.x * sampler.width,
        vertex.uv.y * sampler.height,
      ),
  );
  const e01 = points[0].distanceTo(points[1]);
  const e12 = points[1].distanceTo(points[2]);
  const e20 = points[2].distanceTo(points[0]);
  const edgePixels = Math.max(e01, e12, e20);
  const areaPixels =
    Math.abs(
      (points[1].x - points[0].x) * (points[2].y - points[0].y) -
        (points[1].y - points[0].y) * (points[2].x - points[0].x),
    ) * 0.5;

  return { edgePixels, areaPixels };
}

function evaluateDetailError(
  triangle: BakeTriangle,
  ctx: MaterialSamplingContext,
  includePbrDetails: boolean,
  bakeColorMode: BakeColorMode,
): DetailError {
  if (!triangle.vertices.every((vertex) => vertex.hasUv))
    return { color: 0, pbr: 0, uvEdgePixels: 0, uvAreaPixels: 0 };

  const sampleUvs = detailSampleUvs(triangle);

  const colorSamples = ctx.baseSampler || ctx.emissiveSampler
    ? sampleUvs.map((uv) => textureColorAt(ctx, uv, bakeColorMode))
    : [];
  const color =
    colorSamples.length > 1 ? maxPairwiseColorDistance(colorSamples) : 0;
  const coverage = uvCoverageInPixels(triangle, ctx);

  if (!includePbrDetails)
    return {
      color,
      pbr: 0,
      uvEdgePixels: coverage.edgePixels,
      uvAreaPixels: coverage.areaPixels,
    };

  let pbr = 0;
  if (ctx.normalSampler) {
    const samples = sampleUvs.map((uv) =>
      sampleTexture(ctx.normalSampler!, uv.x, uv.y),
    );
    for (let i = 0; i < samples.length; i += 1) {
      for (let j = i + 1; j < samples.length; j += 1) {
        pbr = Math.max(pbr, normalVectorDelta(samples[i], samples[j]));
      }
    }
  }
  if (ctx.bumpSampler) {
    pbr = Math.max(
      pbr,
      maxPairwiseScalarDistance(
        sampleUvs.map((uv) =>
          luminance(sampleTexture(ctx.bumpSampler!, uv.x, uv.y)),
        ),
      ) * 0.85,
    );
  }
  if (ctx.displacementSampler) {
    pbr = Math.max(
      pbr,
      maxPairwiseScalarDistance(
        sampleUvs.map((uv) =>
          luminance(sampleTexture(ctx.displacementSampler!, uv.x, uv.y)),
        ),
      ) * 1.0,
    );
  }
  if (ctx.roughnessSampler) {
    pbr = Math.max(
      pbr,
      maxPairwiseScalarDistance(
        sampleUvs.map((uv) =>
          sampleTextureChannel(ctx.roughnessSampler!, uv.x, uv.y, "g"),
        ),
      ) * 0.7,
    );
  }
  if (ctx.aoSampler) {
    pbr = Math.max(
      pbr,
      maxPairwiseScalarDistance(
        sampleUvs.map((uv) =>
          sampleTextureChannel(ctx.aoSampler!, uv.x, uv.y, "r"),
        ),
      ) * 0.8,
    );
  }
  if (ctx.metalnessSampler) {
    pbr = Math.max(
      pbr,
      maxPairwiseScalarDistance(
        sampleUvs.map((uv) =>
          sampleTextureChannel(ctx.metalnessSampler!, uv.x, uv.y, "b"),
        ),
      ) * 0.35,
    );
  }

  return {
    color,
    pbr,
    uvEdgePixels: coverage.edgePixels,
    uvAreaPixels: coverage.areaPixels,
  };
}

function detailScore(
  detail: DetailError,
  maxColorError: number,
  maxPbrError: number,
  maxUvEdgePixels: number,
  maxUvAreaPixels: number,
  includePbrDetails: boolean,
): number {
  const colorScore = maxColorError > 0 ? detail.color / maxColorError : 0;
  const pbrScore =
    includePbrDetails && maxPbrError > 0 ? detail.pbr / maxPbrError : 0;
  const uvEdgeScore =
    maxUvEdgePixels > 0 ? detail.uvEdgePixels / maxUvEdgePixels : 0;
  const uvAreaScore =
    maxUvAreaPixels > 0 ? detail.uvAreaPixels / maxUvAreaPixels : 0;
  return Math.max(colorScore, pbrScore, uvEdgeScore, uvAreaScore);
}

function subdivideTriangle(triangle: BakeTriangle): BakeTriangle[] {
  const [a, b, c] = triangle.vertices;
  const ab = midVertex(a, b);
  const bc = midVertex(b, c);
  const ca = midVertex(c, a);
  const depth = triangle.depth + 1;
  return [
    { vertices: [a, ab, ca], depth },
    { vertices: [ab, b, bc], depth },
    { vertices: [ca, bc, c], depth },
    { vertices: [ab, bc, ca], depth },
  ];
}

function subdivideWorkTriangle(triangle: WorkTriangle): WorkTriangle[] {
  return subdivideTriangle(triangle).map((child) => ({
    ...child,
    ctx: triangle.ctx,
    vertexColor: triangle.vertexColor,
  }));
}

/**
 * Converts a textured Three.js scene into baked per-face vertex colours. The
 * returned scene is detached from the source scene so preview, OBJ export and
 * handoff can share the same baked geometry without mutating the imported model.
 */
export function bakeSceneToFaceColors(
  scene: THREE.Object3D,
  options: TextureBakeOptions = {},
): { scene: THREE.Object3D; report: TextureBakeReport } {
  scene.updateMatrixWorld(true);

  const bakedRoot = new THREE.Group();
  bakedRoot.name = `${scene.name || "Model"} - baked face colors`;

  const resolved = resolveOptions(options);
  const colourCorrection = normaliseColourCorrection(resolved.colourCorrection);
  const sceneBox = new THREE.Box3().setFromObject(scene);
  const sceneSize = new THREE.Vector3();
  sceneBox.getSize(sceneSize);
  const sceneDiagonal = Math.max(sceneSize.length(), 1e-6);
  const reliefStrengthAbsolute =
    sceneDiagonal * (resolved.reliefStrengthPercent / 100);
  const textureCache = new Map<THREE.Texture, SamplerData>();
  const colorCounts = new Map<string, number>();
  const colorBlockBinSize = 24;
  const colorBlockAccumulators = new Map<
    string,
    { count: number; r: number; g: number; b: number }
  >();
  const warnings = new Set<string>();

  let meshCount = 0;
  let triangleCount = 0;
  let bakedTriangles = 0;
  let texturedTriangles = 0;
  let materialFallbackTriangles = 0;
  let vertexColorFallbackTriangles = 0;
  let missingUvTriangles = 0;
  let missingMaterialTriangles = 0;
  let bakedVertexCount = 0;
  let subdividedParentTriangles = 0;
  let colorTriggeredSubdivisions = 0;
  let pbrTriggeredSubdivisions = 0;
  let uvCoverageTriggeredSubdivisions = 0;
  let baseSubdividedParentTriangles = 0;
  let adaptivePasses = 0;
  let budgetSkippedSubdivisions = 0;
  let budgetLimitReached = false;
  let maxDepthReached = 0;
  let colorDetailSum = 0;
  let colorDetailSamples = 0;
  let pbrDetailSum = 0;
  let pbrDetailSamples = 0;
  let maxColorDetailError = 0;
  let maxPbrDetailError = 0;
  let uvEdgePixelsSum = 0;
  let uvAreaPixelsSum = 0;
  let uvCoverageSamples = 0;
  let maxUvEdgePixels = 0;
  let maxUvAreaPixels = 0;
  let reliefSource: ReliefSource = "none";
  let reliefSampledVertices = 0;
  let reliefAffectedVertices = 0;
  let reliefMeshesWithSource = 0;
  let reliefMissingSourceTriangles = 0;
  let reliefHeightSum = 0;
  let reliefMinHeight = Number.POSITIVE_INFINITY;
  let reliefMaxHeight = Number.NEGATIVE_INFINITY;
  let reliefMaxDisplacement = 0;
  let reliefSeamLockedVertices = 0;
  let bakedOpenEdges = 0;
  let bakedNonManifoldEdges = 0;
  let normalMapOnlyForRelief = false;
  let reliefConformingSubdivision = false;
  let conformingSubdivision = false;
  let effectiveBalancedBaseDepth =
    resolved.subdivisionMode === "adaptive"
      ? Math.min(resolved.balancedBaseDepth, resolved.maxSubdivisionDepth)
      : 0;

  const trackDetail = (detail: DetailError): void => {
    maxColorDetailError = Math.max(maxColorDetailError, detail.color);
    maxPbrDetailError = Math.max(maxPbrDetailError, detail.pbr);
    maxUvEdgePixels = Math.max(maxUvEdgePixels, detail.uvEdgePixels);
    maxUvAreaPixels = Math.max(maxUvAreaPixels, detail.uvAreaPixels);
    if (
      detail.color > 0 ||
      detail.pbr > 0 ||
      detail.uvEdgePixels > 0 ||
      detail.uvAreaPixels > 0
    ) {
      colorDetailSum += detail.color;
      colorDetailSamples += 1;
      pbrDetailSum += detail.pbr;
      pbrDetailSamples += 1;
      uvEdgePixelsSum += detail.uvEdgePixels;
      uvAreaPixelsSum += detail.uvAreaPixels;
      uvCoverageSamples += 1;
    }
  };

  const evaluateWorkTriangle = (
    triangle: WorkTriangle,
  ): EvaluatedWorkTriangle => {
    const detail = evaluateDetailError(
      triangle,
      triangle.ctx,
      resolved.includePbrDetails,
      resolved.bakeColorMode,
    );
    trackDetail(detail);
    const colorTooHigh = detail.color > resolved.maxColorError;
    const pbrTooHigh =
      resolved.includePbrDetails && detail.pbr > resolved.maxPbrError;
    const uvCoverageTooHigh =
      detail.uvEdgePixels > resolved.maxUvEdgePixels ||
      detail.uvAreaPixels > resolved.maxUvAreaPixels;
    return {
      triangle,
      detail,
      colorTooHigh,
      pbrTooHigh,
      uvCoverageTooHigh,
      score: detailScore(
        detail,
        resolved.maxColorError,
        resolved.maxPbrError,
        resolved.maxUvEdgePixels,
        resolved.maxUvAreaPixels,
        resolved.includePbrDetails,
      ),
    };
  };

  const splitSelectedLeaves = (
    leaves: WorkTriangle[],
    selected: Set<WorkTriangle>,
  ): WorkTriangle[] => {
    const next: WorkTriangle[] = [];
    for (const leaf of leaves) {
      if (selected.has(leaf)) next.push(...subdivideWorkTriangle(leaf));
      else next.push(leaf);
    }
    return next;
  };

  const edgeKeysForTriangle = (triangle: WorkTriangle): [string, string, string] => {
    const [a, b, c] = triangle.vertices;
    return [
      sortedEdgeKey(reliefPositionKey(a.position), reliefPositionKey(b.position)),
      sortedEdgeKey(reliefPositionKey(b.position), reliefPositionKey(c.position)),
      sortedEdgeKey(reliefPositionKey(c.position), reliefPositionKey(a.position)),
    ];
  };

  const splitWorkTriangleByMask = (
    triangle: WorkTriangle,
    mask: number,
  ): WorkTriangle[] => {
    if (mask === 0) return [triangle];
    if (mask === 7) return subdivideWorkTriangle(triangle);

    const [a, b, c] = triangle.vertices;
    const ab = (mask & 1) !== 0 ? midVertex(a, b) : null;
    const bc = (mask & 2) !== 0 ? midVertex(b, c) : null;
    const ca = (mask & 4) !== 0 ? midVertex(c, a) : null;
    const depth = triangle.depth + 1;
    const make = (vertices: [BakeVertex, BakeVertex, BakeVertex]): WorkTriangle => ({
      vertices,
      depth,
      ctx: triangle.ctx,
      vertexColor: triangle.vertexColor,
    });

    if (mask === 1 && ab) return [make([a, ab, c]), make([ab, b, c])];
    if (mask === 2 && bc) return [make([b, bc, a]), make([bc, c, a])];
    if (mask === 4 && ca) return [make([c, ca, b]), make([ca, a, b])];

    if (mask === 3 && ab && bc)
      return [make([b, bc, ab]), make([ab, bc, c]), make([a, ab, c])];
    if (mask === 6 && bc && ca)
      return [make([c, ca, bc]), make([bc, ca, a]), make([b, bc, a])];
    if (mask === 5 && ca && ab)
      return [make([a, ab, ca]), make([ca, ab, b]), make([c, ca, b])];

    return subdivideWorkTriangle(triangle);
  };

  const maskAdditionalTriangles = (mask: number): number =>
    ((mask & 1) ? 1 : 0) + ((mask & 2) ? 1 : 0) + ((mask & 4) ? 1 : 0);

  const refineWorkTrianglesConforming = (
    roots: WorkTriangle[],
    meshBudget: number,
  ): WorkTriangle[] => {
    if (resolved.subdivisionMode !== "adaptive" || roots.length === 0)
      return roots;

    // Slicer-safe subdivision needs matching split points on both sides of a
    // shared edge. Version 0.5.12 used only a uniform depth and therefore could
    // not spend remaining budget on small high-frequency texture details. This
    // version keeps the initial uniform base, then marks shared edges and splits
    // every triangle touching a marked edge. One-sided T-junctions are avoided,
    // while additional budget can still be used where the texture has detail.
    let leaves = roots;
    const baseDepth = Math.max(
      0,
      Math.min(resolved.balancedBaseDepth, resolved.maxSubdivisionDepth),
    );
    conformingSubdivision = baseDepth > 0;
    reliefConformingSubdivision = resolved.reliefEnabled && baseDepth > 0;
    effectiveBalancedBaseDepth = baseDepth;

    for (let targetDepth = 1; targetDepth <= baseDepth; targetDepth += 1) {
      const candidates = leaves.filter((leaf) => leaf.depth < targetDepth);
      if (candidates.length === 0) continue;
      const requiredAdditional = candidates.length * 3;
      if (leaves.length + requiredAdditional > meshBudget) {
        budgetLimitReached = true;
        budgetSkippedSubdivisions += candidates.length;
        break;
      }
      const selected = new Set<WorkTriangle>(candidates);
      baseSubdividedParentTriangles += selected.size;
      leaves = splitSelectedLeaves(leaves, selected);
    }

    for (
      let pass = 0;
      pass < Math.max(0, resolved.maxSubdivisionDepth - baseDepth);
      pass += 1
    ) {
      const edgeRefs = new Map<
        string,
        Array<{ triangleIndex: number; bit: 1 | 2 | 4 }>
      >();
      const triangleEdgeKeys: Array<[string, string, string]> = [];
      for (let i = 0; i < leaves.length; i += 1) {
        const keys = edgeKeysForTriangle(leaves[i]);
        triangleEdgeKeys.push(keys);
        const refs: Array<[string, 1 | 2 | 4]> = [
          [keys[0], 1],
          [keys[1], 2],
          [keys[2], 4],
        ];
        for (const [key, bit] of refs) {
          const entries = edgeRefs.get(key) ?? [];
          entries.push({ triangleIndex: i, bit });
          edgeRefs.set(key, entries);
        }
      }

      const candidates: EvaluatedWorkTriangle[] = [];
      for (const leaf of leaves) {
        if (leaf.depth >= resolved.maxSubdivisionDepth) continue;
        const evaluated = evaluateWorkTriangle(leaf);
        if (
          evaluated.colorTooHigh ||
          evaluated.pbrTooHigh ||
          evaluated.uvCoverageTooHigh
        )
          candidates.push(evaluated);
      }
      if (candidates.length === 0) break;

      candidates.sort(
        (a, b) =>
          b.score - a.score ||
          b.detail.uvEdgePixels - a.detail.uvEdgePixels ||
          a.triangle.depth - b.triangle.depth,
      );

      const masks = new Uint8Array(leaves.length);
      const leafIndexByRef = new Map<WorkTriangle, number>();
      for (let i = 0; i < leaves.length; i += 1) leafIndexByRef.set(leaves[i], i);
      let additionalTriangles = 0;
      let selectedCandidates = 0;

      const estimateDeltaForEdges = (edges: string[]): number => {
        const touched = new Map<number, number>();
        for (const edge of edges) {
          const refs = edgeRefs.get(edge) ?? [];
          for (const ref of refs) {
            const nextMask = (touched.get(ref.triangleIndex) ?? masks[ref.triangleIndex]) | ref.bit;
            touched.set(ref.triangleIndex, nextMask);
          }
        }
        let delta = 0;
        for (const [triangleIndex, nextMask] of touched) {
          delta +=
            maskAdditionalTriangles(nextMask) -
            maskAdditionalTriangles(masks[triangleIndex]);
        }
        return delta;
      };

      const applyEdges = (edges: string[]): void => {
        for (const edge of edges) {
          const refs = edgeRefs.get(edge) ?? [];
          for (const ref of refs) {
            const previous = masks[ref.triangleIndex];
            const next = previous | ref.bit;
            if (next !== previous) {
              additionalTriangles +=
                maskAdditionalTriangles(next) - maskAdditionalTriangles(previous);
              masks[ref.triangleIndex] = next;
            }
          }
        }
      };

      for (const entry of candidates) {
        const triangleIndex = leafIndexByRef.get(entry.triangle) ?? -1;
        if (triangleIndex < 0) continue;
        const edges = triangleEdgeKeys[triangleIndex];
        const delta = estimateDeltaForEdges(edges);
        if (delta <= 0) continue;
        if (leaves.length + additionalTriangles + delta > meshBudget) {
          budgetLimitReached = true;
          budgetSkippedSubdivisions += 1;
          continue;
        }
        applyEdges(edges);
        selectedCandidates += 1;
        if (entry.colorTooHigh) colorTriggeredSubdivisions += 1;
        if (entry.pbrTooHigh) pbrTriggeredSubdivisions += 1;
        if (entry.uvCoverageTooHigh) uvCoverageTriggeredSubdivisions += 1;
      }

      if (additionalTriangles <= 0 || selectedCandidates === 0) {
        if (candidates.length > 0) budgetLimitReached = true;
        break;
      }

      adaptivePasses += 1;
      subdividedParentTriangles += selectedCandidates;
      let nextLeaves: WorkTriangle[] = [];
      for (let i = 0; i < leaves.length; i += 1) {
        const mask = masks[i];
        if (mask === 0) nextLeaves.push(leaves[i]);
        else nextLeaves.push(...splitWorkTriangleByMask(leaves[i], mask));
      }
      leaves = nextLeaves;
    }

    for (const leaf of leaves) {
      const detail = evaluateDetailError(
        leaf,
        leaf.ctx,
        resolved.includePbrDetails,
        resolved.bakeColorMode,
      );
      trackDetail(detail);
      if (leaf.depth >= resolved.maxSubdivisionDepth) {
        const colorTooHigh = detail.color > resolved.maxColorError;
        const pbrTooHigh =
          resolved.includePbrDetails && detail.pbr > resolved.maxPbrError;
        const uvCoverageTooHigh =
          detail.uvEdgePixels > resolved.maxUvEdgePixels ||
          detail.uvAreaPixels > resolved.maxUvAreaPixels;
        if (colorTooHigh || pbrTooHigh || uvCoverageTooHigh)
          maxDepthReached += 1;
      }
    }

    return leaves;
  };

  const refineWorkTrianglesBalanced = (
    roots: WorkTriangle[],
    meshBudget: number,
  ): WorkTriangle[] => {
    if (resolved.subdivisionMode !== "adaptive" || roots.length === 0)
      return roots;

    let leaves = roots;
    const baseDepth = Math.max(
      0,
      Math.min(resolved.balancedBaseDepth, resolved.maxSubdivisionDepth),
    );

    for (let targetDepth = 1; targetDepth <= baseDepth; targetDepth += 1) {
      const candidates = leaves.filter((leaf) => leaf.depth < targetDepth);
      if (candidates.length === 0) continue;
      const availableSplits = Math.floor((meshBudget - leaves.length) / 3);
      if (availableSplits <= 0) {
        budgetLimitReached = true;
        budgetSkippedSubdivisions += candidates.length;
        break;
      }

      const selected = new Set<WorkTriangle>(
        candidates.slice(0, availableSplits),
      );
      baseSubdividedParentTriangles += selected.size;
      if (selected.size < candidates.length) {
        budgetLimitReached = true;
        budgetSkippedSubdivisions += candidates.length - selected.size;
      }
      leaves = splitSelectedLeaves(leaves, selected);
    }

    for (
      let depth = baseDepth;
      depth < resolved.maxSubdivisionDepth;
      depth += 1
    ) {
      const candidates: EvaluatedWorkTriangle[] = [];

      for (const leaf of leaves) {
        if (leaf.depth >= resolved.maxSubdivisionDepth) continue;
        const evaluated = evaluateWorkTriangle(leaf);
        if (
          evaluated.colorTooHigh ||
          evaluated.pbrTooHigh ||
          evaluated.uvCoverageTooHigh
        )
          candidates.push(evaluated);
      }

      if (candidates.length === 0) break;
      adaptivePasses += 1;

      const availableSplits = Math.floor((meshBudget - leaves.length) / 3);
      if (availableSplits <= 0) {
        budgetLimitReached = true;
        budgetSkippedSubdivisions += candidates.length;
        break;
      }

      candidates.sort(
        (a, b) =>
          a.triangle.depth - b.triangle.depth ||
          b.detail.uvEdgePixels - a.detail.uvEdgePixels ||
          b.score - a.score,
      );
      const selectedEvaluations = candidates.slice(0, availableSplits);
      const selected = new Set<WorkTriangle>(
        selectedEvaluations.map((entry) => entry.triangle),
      );

      subdividedParentTriangles += selectedEvaluations.length;
      for (const entry of selectedEvaluations) {
        if (entry.colorTooHigh) colorTriggeredSubdivisions += 1;
        if (entry.pbrTooHigh) pbrTriggeredSubdivisions += 1;
        if (entry.uvCoverageTooHigh) uvCoverageTriggeredSubdivisions += 1;
      }

      if (selectedEvaluations.length < candidates.length) {
        budgetLimitReached = true;
        budgetSkippedSubdivisions +=
          candidates.length - selectedEvaluations.length;
      }

      leaves = splitSelectedLeaves(leaves, selected);

      if (selectedEvaluations.length < candidates.length) break;
    }

    for (const leaf of leaves) {
      if (leaf.depth >= resolved.maxSubdivisionDepth) {
        const detail = evaluateDetailError(
          leaf,
          leaf.ctx,
          resolved.includePbrDetails,
          resolved.bakeColorMode,
        );
        const colorTooHigh = detail.color > resolved.maxColorError;
        const pbrTooHigh =
          resolved.includePbrDetails && detail.pbr > resolved.maxPbrError;
        const uvCoverageTooHigh =
          detail.uvEdgePixels > resolved.maxUvEdgePixels ||
          detail.uvAreaPixels > resolved.maxUvAreaPixels;
        if (colorTooHigh || pbrTooHigh || uvCoverageTooHigh)
          maxDepthReached += 1;
      }
    }

    return leaves;
  };

  const applyReliefToVertex = (
    vertex: BakeVertex,
    ctx: MaterialSamplingContext,
    reliefPositionCache: Map<string, ReliefPositionCacheEntry>,
  ): BakeVertex => {
    if (!resolved.reliefEnabled || !vertex.hasUv) return vertex;

    const key = reliefPositionKey(vertex.position);
    const cached = reliefPositionCache.get(key);
    if (cached) {
      reliefSeamLockedVertices += 1;
      return { ...vertex, position: cached.position.clone() };
    }

    const relief = reliefSourceForContext(ctx, resolved.reliefUsePbrProxy);
    if (!relief.sampler) {
      reliefPositionCache.set(key, {
        position: vertex.position.clone(),
        sampled: false,
        affected: false,
      });
      return vertex;
    }

    if (
      reliefSourcePriority(relief.source) > reliefSourcePriority(reliefSource)
    ) {
      reliefSource = relief.source;
    }

    const height = heightFromReliefSource(
      ctx,
      relief.source,
      relief.sampler,
      vertex.uv,
      resolved.reliefSmoothing,
    );
    const displacement = (height - 0.5) * reliefStrengthAbsolute;
    reliefSampledVertices += 1;
    reliefHeightSum += height;
    reliefMinHeight = Math.min(reliefMinHeight, height);
    reliefMaxHeight = Math.max(reliefMaxHeight, height);
    reliefMaxDisplacement = Math.max(
      reliefMaxDisplacement,
      Math.abs(displacement),
    );

    if (Math.abs(displacement) <= 1e-12) {
      reliefPositionCache.set(key, {
        position: vertex.position.clone(),
        sampled: true,
        affected: false,
      });
      return vertex;
    }

    reliefAffectedVertices += 1;
    const displaced = vertex.position
      .clone()
      .add(vertex.normal.clone().normalize().multiplyScalar(displacement));
    reliefPositionCache.set(key, {
      position: displaced.clone(),
      sampled: true,
      affected: true,
    });
    return { ...vertex, position: displaced };
  };

  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const outUvs: number[] = [];
  const outColors: number[] = [];
  const reliefPositionCache = new Map<string, ReliefPositionCacheEntry>();
  const workTriangles: WorkTriangle[] = [];

  const emitLeaf = (triangle: WorkTriangle): void => {
    const { ctx, vertexColor } = triangle;
    let color: SrgbColor | null = null;

    if ((ctx.baseSampler || (resolved.bakeColorMode !== "baseColor" && ctx.emissiveSampler)) && triangle.vertices.every((vertex) => vertex.hasUv)) {
      color = representativeTextureColorForTriangle(ctx, triangle, resolved.bakeColorMode);
      texturedTriangles += 1;
    } else if (vertexColor) {
      color = vertexColor;
      vertexColorFallbackTriangles += 1;
    } else if (ctx.material) {
      color = materialBaseColor(ctx.material);
      materialFallbackTriangles += 1;
    } else {
      color = { ...DEFAULT_COLOR };
      missingMaterialTriangles += 1;
    }

    color = applyTextureColourCorrection(color, colourCorrection);

    if (!triangle.vertices.every((vertex) => vertex.hasUv)) missingUvTriangles += 1;

    const relief = reliefSourceForContext(ctx, resolved.reliefUsePbrProxy);
    if (
      resolved.reliefEnabled &&
      (!relief.sampler || !triangle.vertices.every((vertex) => vertex.hasUv))
    ) {
      reliefMissingSourceTriangles += 1;
    }

    const linear = srgbToLinearFloats(color);
    for (const vertex of triangle.vertices) {
      const reliefVertex = applyReliefToVertex(vertex, ctx, reliefPositionCache);
      pushBakeVertex(outPositions, outNormals, outUvs, reliefVertex);
      outColors.push(...linear);
    }

    const hex = srgbToHex(color);
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
    const blockKey = quantizedColorKey(color, colorBlockBinSize);
    const block = colorBlockAccumulators.get(blockKey) ?? {
      count: 0,
      r: 0,
      g: 0,
      b: 0,
    };
    block.count += 1;
    block.r += color.r;
    block.g += color.g;
    block.b += color.b;
    colorBlockAccumulators.set(blockKey, block);
    bakedTriangles += 1;
    bakedVertexCount += 3;
  };

  scene.traverse((object) => {
    if (!isMesh(object)) return;
    const sourceGeometry = object.geometry;
    const position = sourceGeometry.getAttribute("position");
    if (!position) return;

    meshCount += 1;
    const normal = sourceGeometry.getAttribute("normal");
    const uv = sourceGeometry.getAttribute("uv");
    const vertexColors = sourceGeometry.getAttribute("color");
    const index = sourceGeometry.index;
    const materials = toMaterialArray(object.material);
    const localTriangleCount = Math.floor((index ? index.count : position.count) / 3);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
    let meshHasReliefSource = false;

    const readWorldPosition = (vertexIndex: number): THREE.Vector3 =>
      readVector3(position, vertexIndex, new THREE.Vector3()).applyMatrix4(object.matrixWorld);

    const readWorldNormal = (vertexIndex: number, fallback: THREE.Vector3): THREE.Vector3 => {
      const n = readVector3(normal, vertexIndex, fallback).applyMatrix3(normalMatrix);
      if (!Number.isFinite(n.lengthSq()) || n.lengthSq() === 0) return fallback.clone();
      return n.normalize();
    };

    for (let triangleIndex = 0; triangleIndex < localTriangleCount; triangleIndex += 1) {
      const elementStart = triangleIndex * 3;
      const i0 = getIndexAt(index, elementStart, 0);
      const i1 = getIndexAt(index, elementStart, 1);
      const i2 = getIndexAt(index, elementStart, 2);
      const materialIndex = materialIndexForTriangle(sourceGeometry, elementStart);
      const material = materials[materialIndex] as MaterialWithColorMap | undefined;
      const ctx: MaterialSamplingContext = {
        material,
        baseSampler: getTextureSampler(material?.map, textureCache, resolved.textureMaxSize),
        normalSampler: getTextureSampler(material?.normalMap, textureCache, resolved.textureMaxSize),
        bumpSampler: getTextureSampler(material?.bumpMap, textureCache, resolved.textureMaxSize),
        displacementSampler: getTextureSampler(material?.displacementMap, textureCache, resolved.textureMaxSize),
        roughnessSampler: getTextureSampler(material?.roughnessMap, textureCache, resolved.textureMaxSize),
        metalnessSampler: getTextureSampler(material?.metalnessMap, textureCache, resolved.textureMaxSize),
        aoSampler: getTextureSampler(material?.aoMap, textureCache, resolved.textureMaxSize),
        emissiveSampler: getTextureSampler(material?.emissiveMap, textureCache, resolved.textureMaxSize),
        alphaSampler: getTextureSampler(material?.alphaMap, textureCache, resolved.textureMaxSize),
      };

      const hasReliefSource = Boolean(
        ctx.displacementSampler ||
          ctx.bumpSampler ||
          (resolved.reliefUsePbrProxy &&
            (ctx.aoSampler || ctx.roughnessSampler || ctx.metalnessSampler)),
      );
      if (hasReliefSource) meshHasReliefSource = true;
      if (resolved.reliefEnabled && !hasReliefSource && ctx.normalSampler)
        normalMapOnlyForRelief = true;

      triangleCount += 1;
      const p0 = readWorldPosition(i0);
      const p1 = readWorldPosition(i1);
      const p2 = readWorldPosition(i2);
      const faceNormal = new THREE.Vector3()
        .crossVectors(p1.clone().sub(p0), p2.clone().sub(p0))
        .normalize();
      if (!Number.isFinite(faceNormal.lengthSq()) || faceNormal.lengthSq() === 0)
        faceNormal.set(0, 0, 1);

      const rootTriangle: WorkTriangle = {
        vertices: [
          {
            position: p0,
            normal: readWorldNormal(i0, faceNormal),
            uv: readVector2(uv, i0),
            hasUv: Boolean(uv),
            sourceIndex: i0,
          },
          {
            position: p1,
            normal: readWorldNormal(i1, faceNormal),
            uv: readVector2(uv, i1),
            hasUv: Boolean(uv),
            sourceIndex: i1,
          },
          {
            position: p2,
            normal: readWorldNormal(i2, faceNormal),
            uv: readVector2(uv, i2),
            hasUv: Boolean(uv),
            sourceIndex: i2,
          },
        ],
        depth: 0,
        ctx,
        vertexColor: vertexColors ? vertexColorAt(vertexColors, i0, i1, i2) : null,
      };

      workTriangles.push(rootTriangle);
    }

    if (resolved.reliefEnabled && meshHasReliefSource) reliefMeshesWithSource += 1;
  });

  const meshBudget = Math.max(workTriangles.length, resolved.triangleBudget);
  const useConformingSubdivision =
    resolved.subdivisionMode === "adaptive" &&
    (resolved.topologyMode === "slicerSafe" || resolved.reliefEnabled);
  const leafTriangles = useConformingSubdivision
    ? refineWorkTrianglesConforming(workTriangles, meshBudget)
    : refineWorkTrianglesBalanced(workTriangles, meshBudget);
  for (const leaf of leafTriangles) emitLeaf(leaf);

  if (outPositions.length > 0) {
    const bakedGeometry = new THREE.BufferGeometry();
    bakedGeometry.setAttribute("position", new THREE.Float32BufferAttribute(outPositions, 3));
    bakedGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(outNormals, 3));
    bakedGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(outUvs, 2));
    bakedGeometry.setAttribute("color", new THREE.Float32BufferAttribute(outColors, 3));
    bakedGeometry.computeBoundingSphere();
    if (resolved.reliefEnabled) bakedGeometry.computeVertexNormals();
    const bakedTopology = topologyDiagnosticsFromNonIndexedPositions(outPositions);
    bakedOpenEdges += bakedTopology.openEdges;
    bakedNonManifoldEdges += bakedTopology.nonManifoldEdges;

    const bakedMaterial = createBakedMaterial();
    const bakedMesh = new THREE.Mesh(bakedGeometry, bakedMaterial);
    bakedMesh.name = `${scene.name || "Model"} - baked merged`;
    bakedRoot.add(bakedMesh);
  }

  if (triangleCount === 0) warnings.add("No triangles found for baking.");
  if (texturedTriangles === 0)
    warnings.add(
      "No textured triangles were baked. Fallback colours were used.",
    );
  if (missingUvTriangles > 0)
    warnings.add(
      "Some triangles have no UV coordinates. These triangles cannot be sampled from the texture.",
    );
  if (textureCache.size === 0 && texturedTriangles === 0)
    warnings.add("No readable base-colour texture found.");
  if (resolved.bakeColorMode !== "baseColor")
    warnings.add("Extended colour sources active: emissive/alpha information is experimentally included in the baked print colour.");
  if (resolved.textureMaxSize)
    warnings.add(`Textures are scaled before sampling to a maximum of ${resolved.textureMaxSize} px edge length. This reduces noise and memory use but can smooth fine details.`);
  if (resolved.includePbrDetails)
    warnings.add(
      "Normal/bump/PBR maps are not transferred to the baked model as print colours or material effects. They only serve as geometry indicators for subdivision.",
    );
  if (
    resolved.subdivisionMode === "adaptive" &&
    resolved.topologyMode === "slicerSafe"
  )
    warnings.add(
      "Slicer-safe subdivision is active: the app uses conforming adaptive edge splits without T-junctions. The triangle budget remains an upper limit.",
    );
  if (resolved.subdivisionMode === "off")
    warnings.add(
      "Subdivision is off: the texture is baked only onto the original input triangles. This remains topologically slicer-safe but loses fine texture detail.",
    );
  if (resolved.reliefEnabled && reliefSource === "none")
    warnings.add(
      "Relief geometry is active, but no suitable relief source was found. For this model, consider AO/Roughness as an experimental proxy. Normal maps are not reconstructed as height yet.",
    );
  if (normalMapOnlyForRelief)
    warnings.add(
      "Normal map detected: it is used for subdivision, but not reconstructed as physical relief. A separate experimental step will be needed for that.",
    );
  if (resolved.reliefEnabled && reliefSource !== "none")
    warnings.add(
      "Physical relief was experimentally generated from a height/bump map or AO/Roughness proxy. With relief enabled, the app uses conforming edge splits instead of one-sided T-junctions so relief does not create open edges.",
    );
  if (
    resolved.reliefEnabled &&
    ["aoMap", "roughnessMap", "metalnessMap"].includes(reliefSource as string)
  )
    warnings.add(
      "AO/Roughness/Metalness-Roughness is not a true height map. The generated geometry is a test proxy for surface structure.",
    );
  if (bakedOpenEdges > 0)
    warnings.add(
      "The baked model contains open edges. With relief enabled, this indicates open edges in the input model, multiple disconnected shells, or a detail pattern that is not fully conforming yet. Reduce relief strength or increase smoothing if visible gaps occur.",
    );
  if (bakedNonManifoldEdges > 0)
    warnings.add("The baked model contains non-manifold edges.");
  if (budgetLimitReached)
    warnings.add(
      "The triangle budget was reached. Some detailed regions could not be subdivided further.",
    );
  if (maxDepthReached > 0)
    warnings.add(
      "The maximum subdivision depth was reached in individual detail regions.",
    );

  const sortedColors = [...colorCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  const topColors = sortedColors.slice(0, 24).map(([hex, count]) => ({
    hex,
    count,
    percent: bakedTriangles > 0 ? (count / bakedTriangles) * 100 : 0,
  }));

  const sortedColorBlocks = [...colorBlockAccumulators.values()]
    .map((entry) => {
      const avg: SrgbColor = {
        r: entry.r / entry.count,
        g: entry.g / entry.count,
        b: entry.b / entry.count,
      };
      const percent =
        bakedTriangles > 0 ? (entry.count / bakedTriangles) * 100 : 0;
      return {
        hex: srgbToHex(avg),
        count: entry.count,
        percent,
        span: colorBlockSpan(percent),
      };
    })
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));

  const visibleColorBlocks = sortedColorBlocks.slice(0, 120);
  const coveredBlockTriangles = visibleColorBlocks.reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  const remainderCount = bakedTriangles - coveredBlockTriangles;
  const colorBlocks: ColorBlockEntry[] = [
    ...visibleColorBlocks,
    ...(remainderCount > 0
      ? [
          {
            hex: "#202830",
            count: remainderCount,
            percent:
              bakedTriangles > 0 ? (remainderCount / bakedTriangles) * 100 : 0,
            span: colorBlockSpan(
              bakedTriangles > 0 ? (remainderCount / bakedTriangles) * 100 : 0,
            ),
            isRemainder: true,
          },
        ]
      : []),
  ];
  const colorBlockCoveragePercent =
    bakedTriangles > 0 ? (coveredBlockTriangles / bakedTriangles) * 100 : 0;

  const estimatedBakedGeometryBytes =
    bakedVertexCount * (3 * 4 + 3 * 4 + 2 * 4 + 3 * 4);

  return {
    scene: bakedRoot,
    report: {
      meshCount,
      triangleCount,
      bakedTriangles,
      outputTriangles: bakedTriangles,
      subdivisionMode: resolved.subdivisionMode,
      subdivisionQuality: resolved.subdivisionQuality,
      topologyMode: resolved.topologyMode,
      subdivisionFactor: triangleCount > 0 ? bakedTriangles / triangleCount : 0,
      subdividedParentTriangles,
      colorTriggeredSubdivisions,
      pbrTriggeredSubdivisions,
      uvCoverageTriggeredSubdivisions,
      baseSubdividedParentTriangles,
      balancedBaseDepth: effectiveBalancedBaseDepth,
      adaptivePasses,
      budgetSkippedSubdivisions,
      budgetLimitReached,
      maxDepthReached,
      avgColorDetailError:
        colorDetailSamples > 0 ? colorDetailSum / colorDetailSamples : 0,
      maxColorDetailError,
      avgPbrDetailError:
        pbrDetailSamples > 0 ? pbrDetailSum / pbrDetailSamples : 0,
      maxPbrDetailError,
      avgUvEdgePixels:
        uvCoverageSamples > 0 ? uvEdgePixelsSum / uvCoverageSamples : 0,
      maxUvEdgePixels,
      avgUvAreaPixels:
        uvCoverageSamples > 0 ? uvAreaPixelsSum / uvCoverageSamples : 0,
      maxUvAreaPixels,
      texturedTriangles,
      materialFallbackTriangles,
      vertexColorFallbackTriangles,
      missingUvTriangles,
      missingMaterialTriangles,
      uniqueColors: colorCounts.size,
      topColors,
      colorBlocks,
      colorBlockBinSize,
      colorBlockCoveragePercent,
      estimatedBakedGeometryBytes,
      reliefEnabled: resolved.reliefEnabled,
      reliefSource,
      reliefStrengthPercent: resolved.reliefStrengthPercent,
      reliefStrengthAbsolute,
      reliefSampledVertices,
      reliefAffectedVertices,
      reliefMeshesWithSource,
      reliefMissingSourceTriangles,
      reliefMinHeight: reliefSampledVertices > 0 ? reliefMinHeight : 0,
      reliefMaxHeight: reliefSampledVertices > 0 ? reliefMaxHeight : 0,
      reliefAvgHeight:
        reliefSampledVertices > 0 ? reliefHeightSum / reliefSampledVertices : 0,
      reliefMaxDisplacement,
      reliefSeamLockedVertices,
      bakedOpenEdges,
      bakedNonManifoldEdges,
      reliefUsePbrProxy: resolved.reliefUsePbrProxy,
      reliefConformingSubdivision,
      conformingSubdivision,
      bakeColorMode: resolved.bakeColorMode,
      textureMaxSize: resolved.textureMaxSize,
      originalTextureMaxSize: Math.max(0, ...[...textureCache.values()].map((sampler) => Math.max(sampler.sourceWidth, sampler.sourceHeight))),
      effectiveTextureMaxSize: Math.max(0, ...[...textureCache.values()].map((sampler) => Math.max(sampler.width, sampler.height))),
      warnings: [...warnings],
    },
  };
}
