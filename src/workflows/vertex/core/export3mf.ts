import JSZip from "jszip";
import type {
  AccentProtectionMode,
  MeshModel,
  PaletteEntry,
  PhysicalSlot,
  RGB,
  Tri,
  Vec3,
} from "./types";
import { nearestPaletteIndex } from "./quantize";
import { rgbToHex } from "./colour";
import type { Template3mfInfo } from "./template3mf";
import type {
  VirtualExtruderPlan,
  VirtualBlendEntry,
} from "./virtualExtruders";

export type ExportCoordinateMode = "auto" | "keep" | "blender-y-up";
export type ExportBedSource = "template" | "custom";

export interface ExportPlacementOptions {
  coordinateMode: ExportCoordinateMode;
  scale: number;
  targetHeight?: number | null;
  putOnBed: boolean;
  centerOnBed: boolean;
  bedSource: ExportBedSource;
  customBedSize: { x: number; y: number };
  fallbackBedSize: { x: number; y: number };
  defaultExtruder: number;
}

export interface Export3mfOptions {
  fileName: string;
  templateArrayBuffer?: ArrayBuffer | null;
  templateInfo?: Template3mfInfo | null;
  model: MeshModel;
  adjustedColors: RGB[];
  palette: PaletteEntry[];
  physicalSlots: PhysicalSlot[];
  virtualPlan: VirtualExtruderPlan;
  placement: ExportPlacementOptions;
  updateExtruderColour?: boolean;
  accentProtection?: AccentProtectionMode;
}

interface ExportVirtualDefinition {
  id: number;
  color: string;
  components: Array<{ extruder: number; ratio: number }>;
  paletteIndices: number[];
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(9)).toString();
}

function sanitise3mfName(name: string): string {
  const trimmed = name.trim() || "vertexcolor2colormix_export.3mf";
  return trimmed.toLowerCase().endsWith(".3mf") ? trimmed : `${trimmed}.3mf`;
}

function titleFromFilename(name: string): string {
  return sanitise3mfName(name).replace(/\.3mf$/i, "");
}

function modelBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name || "model";
}

function bounds(vertices: Vec3[]): { min: Vec3; max: Vec3; range: Vec3 } {
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

/**
 * OBJ sources differ in their up-axis convention. Auto mode only applies the
 * Blender Y-up conversion when the model bounds strongly indicate that layout;
 * otherwise coordinates are preserved to avoid rotating already-correct models.
 */
function resolveCoordinateMode(
  mode: ExportCoordinateMode,
  vertices: Vec3[],
): Exclude<ExportCoordinateMode, "auto"> {
  if (mode !== "auto") return mode;
  const b = bounds(vertices);
  const [rx, ry, rz] = b.range;
  return ry > Math.max(rx, rz) * 1.1 ? "blender-y-up" : "keep";
}

function transformNoTranslation(
  v: Vec3,
  mode: Exclude<ExportCoordinateMode, "auto">,
  scale: number,
): Vec3 {
  const [x, y, z] = v;
  if (mode === "keep") return [scale * x, scale * y, scale * z];
  // Blender Y-up OBJ to PrusaSlicer/3MF Z-up: X'=X, Y'=Z, Z'=-Y.
  return [scale * x, scale * z, -scale * y];
}

function transformedBounds(
  vertices: Vec3[],
  mode: Exclude<ExportCoordinateMode, "auto">,
  scale: number,
): { min: Vec3; max: Vec3; range: Vec3 } {
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
    const t = transformNoTranslation(v, mode, scale);
    for (let i = 0; i < 3; i++) {
      if (t[i] < min[i]) min[i] = t[i];
      if (t[i] > max[i]) max[i] = t[i];
    }
  }
  return {
    min,
    max,
    range: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

function resolveScale(
  vertices: Vec3[],
  mode: Exclude<ExportCoordinateMode, "auto">,
  requestedScale: number,
  targetHeight?: number | null,
): number {
  const safeScale =
    Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;
  if (!targetHeight || !Number.isFinite(targetHeight) || targetHeight <= 0)
    return safeScale;
  const b = transformedBounds(vertices, mode, 1);
  const zRange = Math.max(1e-9, b.range[2]);
  return targetHeight / zRange;
}

function matrixString(
  mode: Exclude<ExportCoordinateMode, "auto">,
  scale: number,
  tx: number,
  ty: number,
  tz: number,
): string {
  const vals =
    mode === "keep"
      ? [scale, 0, 0, 0, scale, 0, 0, 0, scale, tx, ty, tz]
      : [scale, 0, 0, 0, 0, scale, 0, -scale, 0, tx, ty, tz];
  return vals.map(fmt).join(" ");
}

function buildTransform(
  model: MeshModel,
  templateInfo: Template3mfInfo | null | undefined,
  placement: ExportPlacementOptions,
): {
  transform: string;
  resolvedMode: string;
  resolvedScale: number;
  bedSize?: { x: number; y: number };
} {
  const mode = resolveCoordinateMode(placement.coordinateMode, model.vertices);
  const scale = resolveScale(
    model.vertices,
    mode,
    placement.scale,
    placement.targetHeight,
  );
  const b = transformedBounds(model.vertices, mode, scale);
  let tx = 0;
  let ty = 0;
  let tz = 0;
  let bedSize: { x: number; y: number } | undefined;
  if (placement.centerOnBed) {
    if (placement.bedSource === "template" && templateInfo?.bedSize) {
      bedSize = templateInfo.bedSize;
    } else if (placement.bedSource === "custom") {
      bedSize = placement.customBedSize;
    } else {
      bedSize = placement.fallbackBedSize;
    }
    tx = bedSize.x / 2 - (b.min[0] + b.max[0]) / 2;
    ty = bedSize.y / 2 - (b.min[1] + b.max[1]) / 2;
  }
  if (placement.putOnBed) tz = -b.min[2];
  return {
    transform: matrixString(mode, scale, tx, ty, tz),
    resolvedMode: mode,
    resolvedScale: scale,
    bedSize,
  };
}

export function prusaMmuPaintCode(extruderId: number): string {
  const id = Math.round(extruderId);
  if (id < 1) throw new Error("Extruder ID is too small.");

  // PrusaSlicer mmu_segmentation paint codes are not plain extruder numbers.
  // Physical E1 and E2 use short one-byte codes, E3..E16 use the compact xC
  // form, and E17+ use the extended xxEC form.  The same encoding is used for
  // Full Spectrum virtual extruder IDs, which normally start at E6.
  if (id === 1) return "4";
  if (id === 2) return "8";

  const state = id - 3;
  if (state <= 13) return `${state.toString(16).toUpperCase()}C`;
  const value = state - 14;
  if (value > 0xff) throw new Error("Too many extruders for this encoder.");
  return `${value.toString(16).toUpperCase().padStart(2, "0")}EC`;
}

// Backwards-compatible name for code that refers to virtual IDs only.
export const prusaMmuLeafCode = prusaMmuPaintCode;

function ratioFromComponentCount(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function virtualFromBlend(entry: VirtualBlendEntry): ExportVirtualDefinition {
  const total = Math.max(1, entry.sequence.length);
  return {
    id: entry.virtualId,
    color: rgbToHex(entry.displayRgb),
    components: entry.components.map((component) => ({
      extruder: component.extruder,
      ratio: ratioFromComponentCount(component.count, total),
    })),
    paletteIndices: entry.targetPaletteIndices,
  };
}

function buildExportAssignments(plan: VirtualExtruderPlan): {
  virtuals: ExportVirtualDefinition[];
  paletteToPaintCode: Map<number, string>;
} {
  const virtuals: ExportVirtualDefinition[] =
    plan.virtualBlends.map(virtualFromBlend);
  const paletteToPaintCode = new Map<number, string>();

  for (const entry of virtuals) {
    const code = prusaMmuPaintCode(entry.id);
    for (const paletteIndex of entry.paletteIndices)
      paletteToPaintCode.set(paletteIndex, code);
  }

  // Important: palette colours that are a pure physical extruder must be painted
  // with the physical E1..En paint code.  Exporting them as artificial 100%
  // Full Spectrum virtual extruders can make PrusaSlicer treat affected facets
  // as unpainted/default-extruder areas.
  for (const entry of plan.physicalOnly) {
    const code = prusaMmuPaintCode(entry.physicalExtruder);
    for (const paletteIndex of entry.targetPaletteIndices)
      paletteToPaintCode.set(paletteIndex, code);
  }

  virtuals.sort((a, b) => a.id - b.id);
  return { virtuals, paletteToPaintCode };
}

interface ThumbnailBasis {
  view: Vec3;
  right: Vec3;
  up: Vec3;
}

interface ThumbnailRasterTarget {
  width: number;
  height: number;
  scale: number;
  centerU: number;
  centerV: number;
  image: ImageData;
  z: Float32Array;
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function subtract3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function transformThumbnailVertex(
  v: Vec3,
  mode: Exclude<ExportCoordinateMode, "auto">,
): Vec3 {
  if (mode === "keep") return v;
  const [x, y, z] = v;
  // Match the preview orientation used in the WebApp and the effective orientation
  // PrusaSlicer shows after applying the generated 3MF transform.
  return [x, -z, y];
}

function thumbnailBasisFrontTopLeft(): ThumbnailBasis {
  // Camera position relative to the model: front + top + left.
  // The vector points from model centre to the virtual camera.
  const view = normalize3([-0.72, -1.0, 0.68]);
  const worldUp: Vec3 = [0, 0, 1];
  let right = normalize3(cross3(worldUp, view));
  if (
    !Number.isFinite(right[0]) ||
    Math.hypot(right[0], right[1], right[2]) < 1e-9
  ) {
    right = [1, 0, 0];
  }
  const up = normalize3(cross3(view, right));
  return { view, right, up };
}

function thumbnailPoint(
  basis: ThumbnailBasis,
  v: Vec3,
): [number, number, number] {
  return [dot3(v, basis.right), dot3(v, basis.up), dot3(v, basis.view)];
}

function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return normalize3(cross3(subtract3(b, a), subtract3(c, a)));
}

function shadeThumbnailRgb(rgb: RGB, normal: Vec3, basis: ThumbnailBasis): RGB {
  const facing = Math.abs(dot3(normal, basis.view));
  const shade = 0.58 + 0.42 * Math.max(0, Math.min(1, facing));
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] * shade))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * shade))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * shade))),
  ];
}

function thumbnailEdge(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

function writeThumbnailPixel(
  target: ThumbnailRasterTarget,
  x: number,
  y: number,
  depth: number,
  rgb: RGB,
): void {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  const zi = y * target.width + x;
  if (depth <= target.z[zi]) return;
  target.z[zi] = depth;
  const oi = zi * 4;
  target.image.data[oi] = rgb[0];
  target.image.data[oi + 1] = rgb[1];
  target.image.data[oi + 2] = rgb[2];
  target.image.data[oi + 3] = 255;
}

function rasterizeThumbnailTriangle(
  target: ThumbnailRasterTarget,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  d0: number,
  d1: number,
  d2: number,
  rgb: RGB,
): void {
  const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
  const maxX = Math.min(
    target.width - 1,
    Math.ceil(Math.max(p0[0], p1[0], p2[0])),
  );
  const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
  const maxY = Math.min(
    target.height - 1,
    Math.ceil(Math.max(p0[1], p1[1], p2[1])),
  );
  if (maxX < minX || maxY < minY) return;

  const area = thumbnailEdge(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]);
  if (Math.abs(area) < 1e-6 || (maxX - minX <= 1 && maxY - minY <= 1)) {
    writeThumbnailPixel(
      target,
      Math.round((p0[0] + p1[0] + p2[0]) / 3),
      Math.round((p0[1] + p1[1] + p2[1]) / 3),
      (d0 + d1 + d2) / 3,
      rgb,
    );
    if (Math.abs(area) < 1e-6) return;
  }

  const invArea = 1 / area;
  const epsilon = -1e-5;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = thumbnailEdge(p1[0], p1[1], p2[0], p2[1], px, py) * invArea;
      const w1 = thumbnailEdge(p2[0], p2[1], p0[0], p0[1], px, py) * invArea;
      const w2 = 1 - w0 - w1;
      if (w0 < epsilon || w1 < epsilon || w2 < epsilon) continue;
      writeThumbnailPixel(target, x, y, w0 * d0 + w1 * d1 + w2 * d2, rgb);
    }
  }
}

async function canvasToPngBytes(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Uint8Array> {
  let blob: Blob;
  if ("convertToBlob" in canvas) {
    blob = await canvas.convertToBlob({ type: "image/png" });
  } else {
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("Could not create thumbnail PNG."));
      }, "image/png");
    });
  }
  return new Uint8Array(await blob.arrayBuffer());
}

async function createExportThumbnailPng(
  options: Export3mfOptions,
  resolvedMode: Exclude<ExportCoordinateMode, "auto">,
): Promise<Uint8Array> {
  const size = 768;
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement("canvas"), {
          width: size,
          height: size,
        });
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { alpha: false }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Could not create thumbnail canvas context.");

  const basis = thumbnailBasisFrontTopLeft();
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const sourceVertex of options.model.vertices) {
    const [u, v] = thumbnailPoint(
      basis,
      transformThumbnailVertex(sourceVertex, resolvedMode),
    );
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  const spanU = Math.max(1e-9, maxU - minU);
  const spanV = Math.max(1e-9, maxV - minV);
  const scale = Math.min((size * 0.78) / spanU, (size * 0.78) / spanV);
  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;

  const image = ctx.createImageData(size, size);
  const bg: RGB = [178, 178, 178];
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = bg[0];
    image.data[i + 1] = bg[1];
    image.data[i + 2] = bg[2];
    image.data[i + 3] = 255;
  }
  const target: ThumbnailRasterTarget = {
    width: size,
    height: size,
    scale,
    centerU,
    centerV,
    image,
    z: new Float32Array(size * size),
  };
  target.z.fill(Number.NEGATIVE_INFINITY);

  for (let i = 0; i < options.model.triangles.length; i++) {
    const tri = options.model.triangles[i];
    const a0 = options.model.vertices[tri[0]];
    const b0 = options.model.vertices[tri[1]];
    const c0 = options.model.vertices[tri[2]];
    if (!a0 || !b0 || !c0) continue;
    const a = transformThumbnailVertex(a0, resolvedMode);
    const b = transformThumbnailVertex(b0, resolvedMode);
    const c = transformThumbnailVertex(c0, resolvedMode);

    const source =
      options.adjustedColors[i] ||
      options.model.triangleColors[i] ||
      ([180, 180, 180] as RGB);
    const paletteEntry =
      options.palette[
        nearestPaletteIndex(
          source,
          options.palette,
          options.accentProtection ?? "balanced",
        )
      ];
    const baseRgb = paletteEntry?.rgb ?? source;
    const rgb = shadeThumbnailRgb(baseRgb, triangleNormal(a, b, c), basis);

    const pp0 = thumbnailPoint(basis, a);
    const pp1 = thumbnailPoint(basis, b);
    const pp2 = thumbnailPoint(basis, c);
    const p0: [number, number] = [
      size / 2 + (pp0[0] - centerU) * scale,
      size / 2 - (pp0[1] - centerV) * scale,
    ];
    const p1: [number, number] = [
      size / 2 + (pp1[0] - centerU) * scale,
      size / 2 - (pp1[1] - centerV) * scale,
    ];
    const p2: [number, number] = [
      size / 2 + (pp2[0] - centerU) * scale,
      size / 2 - (pp2[1] - centerV) * scale,
    ];
    rasterizeThumbnailTriangle(target, p0, p1, p2, pp0[2], pp1[2], pp2[2], rgb);
  }

  ctx.putImageData(image, 0, 0);
  return canvasToPngBytes(canvas);
}

function fullSpectrumJson(
  physicalSlots: PhysicalSlot[],
  virtuals: ExportVirtualDefinition[],
): string {
  const physical_extruders = physicalSlots
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((slot) => ({ id: slot.slot, color: rgbToHex(slot.filament.rgb) }));
  const virtual_extruders = virtuals.map((entry) => ({
    id: entry.id,
    kind: "fullspectrum",
    color: entry.color,
    components: entry.components.map((component) => ({
      extruder: component.extruder,
      ratio: Number(component.ratio.toFixed(6)),
    })),
  }));
  return JSON.stringify(
    { physical_extruders, version: 1, virtual_extruders },
    null,
    2,
  );
}

function trianglePaletteIndices(
  adjustedColors: RGB[],
  palette: PaletteEntry[],
  accentProtection: AccentProtectionMode = "balanced",
): number[] {
  return adjustedColors.map(
    (rgb) =>
      palette[nearestPaletteIndex(rgb, palette, accentProtection)]?.index ?? 1,
  );
}

function buildModelXml(
  options: Export3mfOptions,
  paletteToPaintCode: Map<number, string>,
  transform: string,
): string {
  const title = titleFromFilename(options.fileName);
  const model = options.model;
  const paletteIndices = trianglePaletteIndices(
    options.adjustedColors,
    options.palette,
    options.accentProtection ?? "balanced",
  );
  const leafByPaletteIndex = new Map<number, string>();
  for (const paletteIndex of options.palette.map((p) => p.index)) {
    const paintCode = paletteToPaintCode.get(paletteIndex);
    if (!paintCode)
      throw new Error(
        `No extruder assignment for palette colour #${paletteIndex}.`,
      );
    leafByPaletteIndex.set(paletteIndex, paintCode);
  }

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">',
  );
  out.push(' <metadata name="slic3rpe:Version3mf">1</metadata>');
  out.push(' <metadata name="slic3rpe:MmPaintingVersion">2</metadata>');
  out.push(` <metadata name="Title">${xmlEscape(title)}</metadata>`);
  out.push(' <metadata name="Designer"></metadata>');
  out.push(
    ' <metadata name="Description">Converted from OBJ vertex colours by VertexColor2ColorMix. Reduced palette colours are mapped to PrusaSlicer Full Spectrum virtual extruders.</metadata>',
  );
  out.push(' <metadata name="Application">VertexColor2ColorMix</metadata>');
  out.push(" <resources>");
  out.push('  <object id="1" type="model">');
  out.push("   <mesh>");
  out.push("    <vertices>");
  for (const [x, y, z] of model.vertices) {
    out.push(`     <vertex x="${fmt(x)}" y="${fmt(y)}" z="${fmt(z)}"/>`);
  }
  out.push("    </vertices>");
  out.push("    <triangles>");
  for (let i = 0; i < model.triangles.length; i++) {
    const [v1, v2, v3] = model.triangles[i] as Tri;
    const paletteIndex = paletteIndices[i] ?? 1;
    const leaf =
      leafByPaletteIndex.get(paletteIndex) ??
      leafByPaletteIndex.values().next().value ??
      "3C";
    out.push(
      `     <triangle v1="${v1}" v2="${v2}" v3="${v3}" slic3rpe:mmu_segmentation="${leaf}"/>`,
    );
  }
  out.push("    </triangles>");
  out.push("   </mesh>");
  out.push("  </object>");
  out.push(" </resources>");
  out.push(" <build>");
  out.push(`  <item objectid="1" transform="${transform}" printable="1"/>`);
  out.push(" </build>");
  out.push("</model>");
  return out.join("\n") + "\n";
}

function buildModelConfig(
  model: MeshModel,
  outputFileName: string,
  defaultExtruder: number,
): string {
  const title = titleFromFilename(outputFileName);
  const sourceFile = model.name || `${modelBaseName(outputFileName)}.obj`;
  const lastId = Math.max(0, model.triangles.length - 1);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n <object id="1" instances_count="1">\n  <metadata type="object" key="name" value="${xmlEscape(title)}"/>\n  <metadata type="object" key="extruder" value="${Math.max(1, Math.round(defaultExtruder))}"/>\n  <volume firstid="0" lastid="${lastId}">\n   <metadata type="volume" key="name" value="${xmlEscape(title)}"/>\n   <metadata type="volume" key="volume_type" value="ModelPart"/>\n   <metadata type="volume" key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n   <metadata type="volume" key="source_file" value="${xmlEscape(sourceFile)}"/>\n   <metadata type="volume" key="source_object_id" value="0"/>\n   <metadata type="volume" key="source_volume_id" value="0"/>\n   <metadata type="volume" key="source_offset_x" value="0"/>\n   <metadata type="volume" key="source_offset_y" value="0"/>\n   <metadata type="volume" key="source_offset_z" value="0"/>\n   <mesh edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n  </volume>\n </object>\n</config>\n`;
}

function writeContentTypes(includePng: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n${includePng ? ' <Default Extension="png" ContentType="image/png"/>\n' : ""}</Types>\n`;
}

function writeRels(includeThumbnail: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n${includeThumbnail ? ' <Relationship Target="/Metadata/thumbnail.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n' : ""}</Relationships>\n`;
}

function targetPhysicalExtruderCount(slots: PhysicalSlot[]): number {
  return Math.max(
    1,
    slots.length,
    ...slots.map((slot) => Math.max(1, Math.round(slot.slot))),
  );
}

function sortedPhysicalSlots(slots: PhysicalSlot[]): PhysicalSlot[] {
  return slots.slice().sort((a, b) => a.slot - b.slot);
}

function colourList(slots: PhysicalSlot[]): string {
  return physicalSlotColours(slots).join(";");
}

function physicalSlotColours(slots: PhysicalSlot[]): string[] {
  const targetCount = targetPhysicalExtruderCount(slots);
  const sorted = sortedPhysicalSlots(slots);
  const bySlot = new Map<number, string>();
  for (const slot of sorted) bySlot.set(Math.max(1, Math.round(slot.slot)), rgbToHex(slot.filament.rgb));
  const fallback = sorted.length > 0 ? rgbToHex(sorted[sorted.length - 1].filament.rgb) : "#FFFFFF";
  const colours: string[] = [];
  for (let slot = 1; slot <= targetCount; slot++) {
    colours.push(bySlot.get(slot) ?? colours[colours.length - 1] ?? fallback);
  }
  return colours;
}

function repeatValue(value: string, count: number, separator: string): string {
  return Array.from({ length: count }, () => value).join(separator);
}

function prusaConfigLine(key: string, value: string): string {
  // PrusaSlicer stores project-wide config values in Slic3r_PE.config
  // as semicolon-prefixed lines.  Writing active-looking INI lines here is
  // ignored by PrusaSlicer when opening a 3MF project, so keep the same
  // Prusa project config syntax for both updated and appended keys.
  return `; ${key} = ${value}`;
}

interface ParsedConfigLine {
  key: string;
  value: string;
  commented: boolean;
}

function parseConfigLine(raw: string): ParsedConfigLine | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const commented = trimmed.startsWith(";");
  const body = commented ? trimmed.slice(1).trim() : trimmed;
  if (!body.includes("=")) return null;
  const eq = body.indexOf("=");
  const key = body.slice(0, eq).trim();
  const value = body.slice(eq + 1).trim();
  return key ? { key, value, commented } : null;
}

const FILAMENT_SLOT_KEYS = new Set<string>([
  "bed_temperature",
  "bridge_fan_speed",
  "chamber_temperature",
  "compatible_printers",
  "compatible_printers_condition",
  "compatible_prints",
  "compatible_prints_condition",
  "cooling",
  "disable_fan_first_layers",
  "end_filament_gcode",
  "fan_always_on",
  "filament_abrasive",
  "filament_colour",
  "filament_cost",
  "filament_cooling_final_speed",
  "filament_cooling_initial_speed",
  "filament_cooling_moves",
  "filament_custom_variables",
  "filament_density",
  "filament_deretract_speed",
  "filament_diameter",
  "filament_end_gcode",
  "filament_flush_speed",
  "filament_flush_volume",
  "filament_infill_max_crossing_speed",
  "filament_infill_max_speed",
  "filament_load_time",
  "filament_loading_speed",
  "filament_loading_speed_start",
  "filament_max_volumetric_speed",
  "filament_minimal_purge_on_wipe_tower",
  "filament_multitool_ramming",
  "filament_multitool_ramming_flow",
  "filament_multitool_ramming_volume",
  "filament_notes",
  "filament_purge_multiplier",
  "filament_ramming_parameters",
  "filament_retract_before_travel",
  "filament_retract_before_wipe",
  "filament_retract_lift",
  "filament_retract_lift_above",
  "filament_retract_lift_below",
  "filament_retract_length",
  "filament_retract_length_toolchange",
  "filament_retract_layer_change",
  "filament_retract_restart_extra",
  "filament_retract_restart_extra_toolchange",
  "filament_retract_speed",
  "filament_seam_gap_distance",
  "filament_settings_id",
  "filament_shrinkage_compensation_xy",
  "filament_shrinkage_compensation_z",
  "filament_soluble",
  "filament_spool_weight",
  "filament_stamping_distance",
  "filament_stamping_loading_speed",
  "filament_start_gcode",
  "filament_toolchange_delay",
  "filament_travel_lift_before_obstacle",
  "filament_travel_max_lift",
  "filament_travel_ramping_lift",
  "filament_travel_slope",
  "filament_type",
  "filament_unload_time",
  "filament_unloading_speed",
  "filament_unloading_speed_start",
  "filament_wipe",
  "first_layer_bed_temperature",
  "first_layer_temperature",
  "full_fan_speed_layer",
  "max_fan_speed",
  "min_fan_speed",
  "slowdown_below_layer_time",
  "start_filament_gcode",
  "temperature",
]);

const EXTRUDER_SLOT_KEYS = new Set<string>([
  "deretract_speed",
  "extruder_colour",
  "extruder_offset",
  "extrusion_axis",
  "max_layer_height",
  "min_layer_height",
  "nozzle_diameter",
  "nozzle_high_flow",
  "retract_before_travel",
  "retract_before_wipe",
  "retract_layer_change",
  "retract_length",
  "retract_length_toolchange",
  "retract_lift",
  "retract_lift_above",
  "retract_lift_below",
  "retract_restart_extra",
  "retract_restart_extra_toolchange",
  "retract_speed",
  "wipe",
]);


const TEMPLATE_SLOT_EXTEND_KEYS = new Set<string>([
  // Native PrusaSlicer behaviour when a 5-slot MMU template is manually
  // increased to 8 slots.  Do not blindly expand every comma/semicolon list in
  // Slic3r_PE.config: several settings are intentionally left at their template
  // length by PrusaSlicer and some scalar strings contain semicolons inside
  // quoted G-code or condition expressions.
  "bed_temperature",
  "bridge_fan_speed",
  "chamber_temperature",
  "cooling",
  "deretract_speed",
  "disable_fan_first_layers",
  "end_filament_gcode",
  "extruder_colour",
  "extruder_offset",
  "extrusion_axis",
  "fan_always_on",
  "filament_abrasive",
  "filament_colour",
  "filament_cooling_final_speed",
  "filament_cooling_initial_speed",
  "filament_cooling_moves",
  "filament_cost",
  "filament_density",
  "filament_deretract_speed",
  "filament_diameter",
  "filament_infill_max_crossing_speed",
  "filament_infill_max_speed",
  "filament_load_time",
  "filament_loading_speed",
  "filament_loading_speed_start",
  "filament_max_volumetric_speed",
  "filament_minimal_purge_on_wipe_tower",
  "filament_multitool_ramming",
  "filament_multitool_ramming_flow",
  "filament_multitool_ramming_volume",
  "filament_notes",
  "filament_purge_multiplier",
  "filament_ramming_parameters",
  "filament_retract_before_travel",
  "filament_retract_before_wipe",
  "filament_retract_layer_change",
  "filament_retract_length",
  "filament_retract_length_toolchange",
  "filament_retract_lift",
  "filament_retract_lift_above",
  "filament_retract_lift_below",
  "filament_retract_restart_extra",
  "filament_retract_restart_extra_toolchange",
  "filament_retract_speed",
  "filament_seam_gap_distance",
  "filament_settings_id",
  "filament_shrinkage_compensation_xy",
  "filament_shrinkage_compensation_z",
  "filament_soluble",
  "filament_spool_weight",
  "filament_stamping_distance",
  "filament_stamping_loading_speed",
  "filament_toolchange_delay",
  "filament_travel_lift_before_obstacle",
  "filament_travel_max_lift",
  "filament_travel_ramping_lift",
  "filament_travel_slope",
  "filament_type",
  "filament_unload_time",
  "filament_unloading_speed",
  "filament_unloading_speed_start",
  "filament_wipe",
  "first_layer_bed_temperature",
  "first_layer_temperature",
  "full_fan_speed_layer",
  "max_fan_speed",
  "max_layer_height",
  "min_fan_speed",
  "min_layer_height",
  "nozzle_diameter",
  "nozzle_high_flow",
  "retract_before_travel",
  "retract_before_wipe",
  "retract_layer_change",
  "retract_length",
  "retract_length_toolchange",
  "retract_lift",
  "retract_lift_above",
  "retract_lift_below",
  "retract_restart_extra",
  "retract_restart_extra_toolchange",
  "retract_speed",
  "slowdown_below_layer_time",
  "start_filament_gcode",
  "temperature",
  "wipe",
]);

const SEMICOLON_FALLBACKS = new Map<string, string>([
  ["bed_temperature", "60"],
  ["bridge_fan_speed", "100"],
  ["chamber_temperature", "0"],
  ["cooling", "1"],
  ["disable_fan_first_layers", "1"],
  ["fan_always_on", "1"],
  ["filament_cost", "0"],
  ["filament_density", "1.24"],
  ["filament_diameter", "1.75"],
  ["filament_load_time", "0"],
  ["filament_max_volumetric_speed", "0"],
  ["filament_minimal_purge_on_wipe_tower", "15"],
  ["filament_purge_multiplier", "100"],
  ["filament_settings_id", "Generic PLA"],
  ["filament_soluble", "0"],
  ["filament_spool_weight", "0"],
  ["filament_toolchange_delay", "0"],
  ["filament_type", "PLA"],
  ["first_layer_bed_temperature", "60"],
  ["first_layer_temperature", "215"],
  ["max_fan_speed", "100"],
  ["min_fan_speed", "100"],
  ["temperature", "210"],
]);

const COMMA_FALLBACKS = new Map<string, string>([
  ["deretract_speed", "0"],
  ["extruder_offset", "0x0"],
  ["extrusion_axis", "E"],
  ["max_layer_height", "0.25"],
  ["min_layer_height", "0.07"],
  ["nozzle_diameter", "0.4"],
  ["retract_before_travel", "2"],
  ["retract_before_wipe", "0%"],
  ["retract_layer_change", "0"],
  ["retract_length", "0.8"],
  ["retract_length_toolchange", "4"],
  ["retract_lift", "0.4"],
  ["retract_lift_above", "0"],
  ["retract_lift_below", "0"],
  ["retract_restart_extra", "0"],
  ["retract_restart_extra_toolchange", "0"],
  ["retract_speed", "35"],
  ["wipe", "1"],
]);

function splitListValue(value: string, separator: string): string[] {
  if (!value.trim()) return [];
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;
  for (const char of value) {
    if (char === '"' && !escaped) inQuotes = !inQuotes;
    if (char === separator && !inQuotes) {
      tokens.push(current.trim());
      current = "";
    } else {
      current += char;
    }
    escaped = char === "\\" && !escaped;
    if (char !== "\\") escaped = false;
  }
  tokens.push(current.trim());
  return tokens;
}

function hasListSeparator(value: string, separator: string): boolean {
  return splitListValue(value, separator).length > 1;
}

function extendListValue(
  value: string,
  separator: string,
  targetCount: number,
  fallback: string,
): string {
  const tokens = splitListValue(value, separator);
  const fill = tokens.length > 0 ? tokens[tokens.length - 1] : fallback;
  while (tokens.length < targetCount) tokens.push(fill);
  return tokens.slice(0, targetCount).join(separator);
}

function filamentFallback(key: string, separator: string): string {
  if (key === "filament_colour") return "#FF8000";
  if (key === "filament_settings_id") return '"Generic PLA"';
  if (key === "filament_type") return "PLA";
  if (separator === ",") return COMMA_FALLBACKS.get(key) ?? SEMICOLON_FALLBACKS.get(key) ?? "0";
  return SEMICOLON_FALLBACKS.get(key) ?? COMMA_FALLBACKS.get(key) ?? "";
}

function parseNumericList(value: string): number[] {
  return splitListValue(value, ",")
    .map((token) => Number(token.trim()))
    .filter((value) => Number.isFinite(value));
}

function inferSquareSize(length: number): number {
  const size = Math.round(Math.sqrt(Math.max(0, length)));
  return size > 0 && size * size === length ? size : 0;
}

function formatWipingVolume(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function extendWipingVolumesMatrix(value: string, targetCount: number): string {
  const source = parseNumericList(value);
  const sourceCount = inferSquareSize(source.length);
  const offDiagonal = source.find((entry, index) => {
    if (entry <= 0) return false;
    if (sourceCount <= 0) return true;
    const row = Math.floor(index / sourceCount);
    const col = index % sourceCount;
    return row !== col;
  });
  const fallback = Number.isFinite(offDiagonal) ? Number(offDiagonal) : 65;
  const out: number[] = [];
  for (let row = 0; row < targetCount; row++) {
    for (let col = 0; col < targetCount; col++) {
      if (sourceCount > 0 && row < sourceCount && col < sourceCount) {
        out.push(source[row * sourceCount + col] ?? (row === col ? 0 : fallback));
      } else {
        out.push(row === col ? 0 : fallback);
      }
    }
  }
  return out.map(formatWipingVolume).join(",");
}

function detectSlotSeparator(parsed: ParsedConfigLine): string | null {
  // Do not treat every filament_* key as a slot list.  Some keys, for example
  // filament_vendor, are scalar values and must be preserved exactly.
  if (parsed.key === "extruder_colour" || parsed.key === "filament_colour") return ";";
  if (parsed.key === "filament_settings_id" || parsed.key === "filament_type") return ";";
  if (parsed.key === "start_filament_gcode" || parsed.key === "end_filament_gcode") return ";";
  if (parsed.key === "filament_notes" || parsed.key === "filament_ramming_parameters") return ";";
  if (isExtruderSlotKey(parsed.key)) return ",";
  if (!FILAMENT_SLOT_KEYS.has(parsed.key)) return null;
  if (hasListSeparator(parsed.value, ";")) return ";";
  if (hasListSeparator(parsed.value, ",")) return ",";
  return ";";
}

function isExtruderSlotKey(key: string): boolean {
  return EXTRUDER_SLOT_KEYS.has(key);
}

function extendKnownSlotLine(
  parsed: ParsedConfigLine,
  targetCount: number,
): string | null {
  if (!TEMPLATE_SLOT_EXTEND_KEYS.has(parsed.key)) return null;
  const separator = detectSlotSeparator(parsed);
  if (!separator) return null;
  const fallback = filamentFallback(parsed.key, separator);
  return extendListValue(parsed.value, separator, targetCount, fallback);
}

function setOrAppendConfigKeys(config: string, values: Map<string, string>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of config.split(/\r?\n/)) {
    const parsed = parseConfigLine(raw);
    if (parsed && values.has(parsed.key)) {
      if (!seen.has(parsed.key)) out.push(prusaConfigLine(parsed.key, values.get(parsed.key) ?? ""));
      seen.add(parsed.key);
      continue;
    }
    out.push(raw);
  }
  for (const [key, value] of values) {
    if (!seen.has(key)) out.push(prusaConfigLine(key, value));
  }
  return out.join("\n");
}

/**
 * Updates only the PrusaSlicer project keys that are required for the selected
 * physical extruder count. Template filament names and filament base colours are
 * intentionally preserved; Color Mix Lab only updates the visible extruder slot
 * colours and the slot-count metadata needed by PrusaSlicer.
 */
function updateSlic3rConfigForPhysicalSlots(
  config: string,
  slots: PhysicalSlot[],
  updateExtruderColour: boolean,
): string {
  const targetCount = targetPhysicalExtruderCount(slots);
  const colourValues = physicalSlotColours(slots);
  const values = new Map<string, string>();

  // Match PrusaSlicer project files as closely as possible: count keys are
  // written explicitly, but only a known-safe subset of per-slot arrays is
  // resized. This avoids corrupting scalar filament fields or embedded G-code.
  values.set("extruders_count", String(targetCount));
  values.set("num_extruders", String(targetCount));
  values.set("single_extruder_multi_material", "1");
  values.set("printer_technology", "FFF");
  values.set("wipe_tower", "1");

  const parsedLines = config.split(/\r?\n/).flatMap((raw) => {
    const parsed = parseConfigLine(raw);
    return parsed ? [parsed] : [];
  });
  const customWipeMatrix =
    parsedLines.find((line) => line.key === "wiping_volumes_use_custom_matrix")?.value.trim() === "1";
  let templateHasWipingMatrix = false;

  for (const parsed of parsedLines) {
    if (parsed.key === "wiping_volumes_matrix") {
      templateHasWipingMatrix = true;
      if (customWipeMatrix) {
        values.set(parsed.key, extendWipingVolumesMatrix(parsed.value, targetCount));
      }
      continue;
    }
    const extended = extendKnownSlotLine(parsed, targetCount);
    if (extended !== null) values.set(parsed.key, extended);
  }

  if (!templateHasWipingMatrix) {
    values.set("wiping_volumes_matrix", extendWipingVolumesMatrix("", targetCount));
    values.set("wiping_volumes_use_custom_matrix", "0");
  }

  if (updateExtruderColour) {
    const colours = colourValues.join(";");
    values.set("extruder_colour", colours);
  }

  // Essential fallbacks for minimal or unusual templates.  For normal templates
  // these keys already exist and were extended above by repeating the last
  // native value, not by replacing user filament presets.
  if (!values.has("filament_settings_id"))
    values.set("filament_settings_id", repeatValue('"Generic PLA"', targetCount, ";"));
  if (!values.has("filament_type"))
    values.set("filament_type", repeatValue("PLA", targetCount, ";"));
  if (!values.has("filament_colour"))
    values.set("filament_colour", repeatValue("#FF8000", targetCount, ";"));
  if (!values.has("filament_diameter"))
    values.set("filament_diameter", repeatValue("1.75", targetCount, ","));
  if (!values.has("nozzle_diameter"))
    values.set("nozzle_diameter", repeatValue("0.4", targetCount, ","));
  if (!values.has("extruder_offset"))
    values.set("extruder_offset", repeatValue("0x0", targetCount, ","));
  if (!values.has("extrusion_axis"))
    values.set("extrusion_axis", repeatValue("E", targetCount, ","));

  return setOrAppendConfigKeys(config, values);
}

function minimalSlic3rConfig(slots: PhysicalSlot[]): string {
  const colours = colourList(slots);
  const count = targetPhysicalExtruderCount(slots);
  return `; generated by Color Mix Lab
; Prefer exporting with a configured PrusaSlicer template for real slicing.
; extruders_count = ${count}
; num_extruders = ${count}
; extruder_colour = ${colours}
; filament_colour = ${repeatValue("#FF8000", count, ";")}
; filament_settings_id = ${repeatValue('"Generic PLA"', count, ";")}
; filament_type = ${repeatValue("PLA", count, ";")}
; filament_diameter = ${repeatValue("1.75", count, ",")}
; filament_density = ${repeatValue("1.24", count, ",")}
; first_layer_temperature = ${repeatValue("215", count, ",")}
; temperature = ${repeatValue("210", count, ",")}
; first_layer_bed_temperature = ${repeatValue("60", count, ",")}
; bed_temperature = ${repeatValue("60", count, ",")}
; nozzle_diameter = ${repeatValue("0.4", count, ",")}
; extruder_offset = ${repeatValue("0x0", count, ",")}
; wiping_volumes_matrix = ${extendWipingVolumesMatrix("", count)}
; wiping_volumes_use_custom_matrix = 0
; single_extruder_multi_material = 1
; printer_technology = FFF
; wipe_tower = 1
`;
}

async function loadTemplateZip(
  arrayBuffer?: ArrayBuffer | null,
): Promise<JSZip | null> {
  if (!arrayBuffer) return null;
  try {
    return await JSZip.loadAsync(arrayBuffer.slice(0));
  } catch {
    return null;
  }
}

async function templateText(
  zip: JSZip | null,
  path: string,
): Promise<string | null> {
  const file = zip?.file(path);
  return file ? await file.async("text") : null;
}

async function templateBytes(
  zip: JSZip | null,
  path: string,
): Promise<Uint8Array | null> {
  const file = zip?.file(path);
  return file ? await file.async("uint8array") : null;
}

export async function buildPrusa3mfBlob(
  options: Export3mfOptions,
): Promise<{
  blob: Blob;
  fileName: string;
  summary: {
    virtualCount: number;
    physicalOnlyExportedAsVirtual: number;
    transform: string;
    coordinateMode: string;
    scale: number;
    bedSize?: { x: number; y: number };
  };
}> {
  if (!options.model) throw new Error("No model loaded.");
  if (options.palette.length === 0) throw new Error("No palette generated.");
  if (options.physicalSlots.length === 0)
    throw new Error("No physical extruder colours available.");
  if (options.adjustedColors.length !== options.model.triangleColors.length)
    throw new Error("Adjusted colour data is incomplete.");

  const fileName = sanitise3mfName(options.fileName);
  const templateZip = await loadTemplateZip(options.templateArrayBuffer);
  const { virtuals, paletteToPaintCode } = buildExportAssignments(
    options.virtualPlan,
  );
  if (paletteToPaintCode.size === 0)
    throw new Error("No extruder assignments were generated.");

  const transformResult = buildTransform(
    options.model,
    options.templateInfo,
    options.placement,
  );
  const modelXml = buildModelXml(
    options,
    paletteToPaintCode,
    transformResult.transform,
  );
  const modelConfig = buildModelConfig(
    options.model,
    fileName,
    options.placement.defaultExtruder,
  );
  const fsJson = fullSpectrumJson(options.physicalSlots, virtuals);

  const configText = await templateText(
    templateZip,
    "Metadata/Slic3r_PE.config",
  );
  const wipeTowerBytes = await templateBytes(
    templateZip,
    "Metadata/Prusa_Slicer_wipe_tower_information.xml",
  );
  const generatedThumbnailBytes = await createExportThumbnailPng(
    options,
    transformResult.resolvedMode as Exclude<ExportCoordinateMode, "auto">,
  );

  const zip = new JSZip();
  zip.file("[Content_Types].xml", writeContentTypes(true));
  zip.file("_rels/.rels", writeRels(true));
  zip.file("3D/3dmodel.model", modelXml);
  zip.file(
    "Metadata/Slic3r_PE.config",
    configText
      ? updateSlic3rConfigForPhysicalSlots(
          configText,
          options.physicalSlots,
          options.updateExtruderColour ?? true,
        )
      : minimalSlic3rConfig(options.physicalSlots),
  );
  zip.file("Metadata/Slic3r_PE_model.config", modelConfig);
  zip.file("Metadata/Prusa_Slicer_full_spectrum.json", fsJson);
  zip.file(
    "Metadata/Prusa_Slicer_wipe_tower_information.xml",
    wipeTowerBytes ??
      '<?xml version="1.0" encoding="UTF-8"?>\n<wipe_tower_information/>\n',
  );
  zip.file("Metadata/thumbnail.png", generatedThumbnailBytes);

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return {
    blob,
    fileName,
    summary: {
      virtualCount: virtuals.length,
      physicalOnlyExportedAsVirtual: options.virtualPlan.physicalOnly.length,
      transform: transformResult.transform,
      coordinateMode: transformResult.resolvedMode,
      scale: transformResult.resolvedScale,
      bedSize: transformResult.bedSize,
    },
  };
}
