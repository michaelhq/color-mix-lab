import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { analyzeScene, type MeshDiagnostics } from "./core/analyzeMesh";
import {
  bakeSceneToFaceColors,
  type BakeColorMode,
  type ReliefSmoothing,
  type ReliefSource,
  type SubdivisionMode,
  type SubdivisionQuality,
  type TextureBakeReport,
  type TextureColourCorrection,
} from "./core/textureBake";

type SurfaceDetailMode = "baseColorOnly" | "baseColorAndSurfaceMaps";
type ReliefMode = "off" | "heightBumpOnly" | "aoRoughnessProxy";
type TextureSizeMode =
  | "original"
  | "8192"
  | "4096"
  | "2048"
  | "1024"
  | "512"
  | "custom";
import { exportBakedSceneToVertexColorObj } from "./core/exportObj";
import { downloadBlob } from "./core/zipDownload";
import { extractSupportedModelFilesFromZip } from "./core/readZip";
import ModelPreview, { type CameraSyncState } from "./ui/ModelPreview";
import {
  composeOrientationMatrices,
  IDENTITY_ORIENTATION_MATRIX,
  applyOrientationMatrixToVec3,
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

type UiLanguage = "en";
type ShellTheme = "light" | "dark";

type TranslationKey =
  | "appSubtitle"
  | "language"
  | "lightMode"
  | "darkMode"
  | "modelLoadTitle"
  | "dropLabel"
  | "loadingModel"
  | "selectFile"
  | "reset"
  | "bakingExportTitle"
  | "basis"
  | "preview"
  | "subdivision"
  | "export"
  | "advancedOptions"
  | "bakeColorSources"
  | "bakeColorSourcesTip"
  | "textureResolution"
  | "textureResolutionTip"
  | "customTextureEdge"
  | "sourceResolution"
  | "wireframe"
  | "wireframeTip"
  | "syncViews"
  | "syncViewsTip"
  | "view"
  | "viewTip"
  | "axes"
  | "axesTip"
  | "fitToModel"
  | "fitToModelTip"
  | "resetView"
  | "resetViewTip"
  | "rebuildPreview"
  | "rebuildPreviewTip"
  | "mode"
  | "subdivisionModeTip"
  | "quality"
  | "qualityTip"
  | "triangleBudget"
  | "triangleBudgetTip"
  | "maxDepth"
  | "maxDepthTip"
  | "exportScale"
  | "exportScaleTip"
  | "surfaceDetailSources"
  | "surfaceDetailSourcesTip"
  | "reliefGeometry"
  | "reliefGeometryTip"
  | "reliefStrength"
  | "reliefStrengthTip"
  | "reliefSmoothing"
  | "reliefSmoothingTip"
  | "runBake"
  | "runBakeTip"
  | "baking"
  | "clearBake"
  | "clearBakeTip"
  | "exportObj"
  | "exportObjTip"
  | "exporting"
  | "standardNote"
  | "bakeSummary"
  | "colorDistribution"
  | "colorDistributionTip"
  | "diagnostics"
  | "diagnosticsTip"
  | "showDetails"
  | "hideDetails"
  | "meshDiagnostics"
  | "topologyCheck"
  | "uvMaterialCheck"
  | "notLoaded"
  | "ready"
  | "processing"
  | "originalPreview"
  | "bakedPreview"
  | "loadGlb"
  | "runTextureBaking"
  | "noBakedModel"
  | "progressLoadTitle"
  | "progressBakeTitle"
  | "progressExportTitle"
  | "progressOrientationTitle"
  | "progressOrientationPrepare"
  | "progressOrientationApply"
  | "progressOrientationRefresh"
  | "progressReadFiles"
  | "progressSearchZip"
  | "progressExtractZip"
  | "progressParseModel"
  | "progressCollectScene"
  | "progressAnalyzeMaterials"
  | "progressPreparePreview"
  | "progressPrepareTextures"
  | "progressPrepareBakeGroup"
  | "progressSubdivide"
  | "progressSampleColors"
  | "progressBuildPreview"
  | "progressUpdateStats"
  | "progressPrepareGeometry"
  | "progressWriteVertexColors"
  | "progressBuildObj"
  | "progressDownload"
  | "noWarnings"
  | "issuesDetected"
  | "warningsDetected"
  | "textureWorkflowTitle"
  | "handoffToVertex"
  | "handoffToVertexTip"
  | "handoffProgressTitle"
  | "handoffProgressStep"
  | "handoffPreparing"
  | "handoffPrepared"
  | "handoffFailed"
  | "visibleExperimentalOption"
  | "customOption"
  | "subdivisionAdaptiveOption"
  | "subdivisionOffOption"
  | "qualityFastOption"
  | "qualityMediumOption"
  | "qualityFineOption"
  | "qualityVeryFineOption"
  | "scaleNoneOption"
  | "surfaceBaseOnlyOption"
  | "reliefOffOption"
  | "reliefHeightBumpOnlyOption"
  | "reliefAoRoughnessProxyOption"
  | "reliefSmoothingOffOption"
  | "reliefSmoothingLightOption"
  | "reliefSmoothingStrongOption"
  | "bakeColourCorrection"
  | "bakeColourCorrectionTip"
  | "activeBakeColourCorrection"
  | "prepareBakeColourCorrection"
  | "brightness"
  | "contrast"
  | "saturation"
  | "temperature"
  | "hue"
  | "tint"
  | "gamma"
  | "tipBakeBrightness"
  | "tipBakeContrast"
  | "tipBakeSaturation"
  | "tipBakeTemperature"
  | "tipBakeHue"
  | "tipBakeTint"
  | "tipBakeGamma"
  | "apply"
  | "applyBakeColourCorrectionTip"
  | "resetBakeColourCorrectionTip"
  | "modelOrientation"
  | "modelOrientationTip"
  | "rotate90"
  | "rotateLeft"
  | "rotateRight"
  | "rotateForward"
  | "rotateBackward"
  | "fineRotation"
  | "rotationAxis"
  | "rotationAngle"
  | "applyFineRotation"
  | "setCurrentOrientation"
  | "resetImportedOrientation"
  | "applyOrientationTip"
  | "fineRotationTip"
  | "setCurrentOrientationTip"
  | "resetOrientationTip"
  | "orientationCurrent"
  | "saveTextureProjectTip"
  | "loadTextureProjectTip"
  | "bakeColourCorrectionApplied"
  | "defaultHints";

const I18N: Record<UiLanguage, Record<TranslationKey, string>> = {
  en: {
    appSubtitle:
      "Experimental GLB/ZIP/OBJ texture import for later ColorMix texture baking.",
    language: "Language",
    lightMode: "Light Mode",
    darkMode: "Dark Mode",
    modelLoadTitle: "1. Load model",
    dropLabel: "Select GLB, ZIP, or OBJ+MTL+textures here",
    loadingModel: "Loading model…",
    selectFile: "Select file",
    reset: "Reset",
    bakingExportTitle: "2. Baking and export",
    basis: "Basics",
    preview: "Preview",
    subdivision: "Subdivision",
    export: "Export",
    advancedOptions: "Advanced options",
    bakeColorSources: "Color sources for baking",
    bakeColorSourcesTip:
      "Selects which material channels are baked as printable color. Base Color is the default. Emissive can include HUD/glow graphics; the experimental mode tries to include additional visible material information.",
    textureResolution: "Texture resolution",
    textureResolutionTip:
      "Maximum texture resolution before sampling. Original keeps the source texture; 4K/2K/1K reduce memory usage but can smooth fine patterns.",
    customTextureEdge: "Max. texture edge",
    sourceResolution: "Source resolution",
    wireframe: "Show wireframe",
    wireframeTip:
      "Overlays the triangle structure on the original and baked previews.",
    syncViews: "Synchronize views",
    syncViewsTip:
      "Rotation, panning, and zooming are linked between the original and baked view.",
    view: "View",
    viewTip: "Sets the camera orientation for both texture-baking previews.",
    axes: "Axes",
    axesTip: "Shows a small XYZ axis helper in both previews.",
    fitToModel: "Fit to model",
    fitToModelTip:
      "Fits the current camera to the loaded model bounding box without changing model geometry.",
    resetView: "Reset view",
    resetViewTip:
      "Resets the current preview camera to the selected view orientation.",
    rebuildPreview: "Rebuild preview",
    rebuildPreviewTip:
      "Rebuilds the preview scene using the current display, background, axes and wireframe settings.",
    mode: "Mode",
    subdivisionModeTip:
      "Slicer-safe detail subdivision adds triangles without T-junctions. Off uses only the input model's existing triangles.",
    quality: "Quality",
    qualityTip:
      "Controls triangle budget, subdivision depth, and error thresholds. Higher levels preserve fine texture patterns better but use much more memory and time.",
    triangleBudget: "Triangle budget",
    triangleBudgetTip:
      "Upper limit for generated triangles. The budget is not always fully used. If the input mesh already exceeds this limit, the app warns you; reduce the model externally before import if needed.",
    maxDepth: "Max. subdivision depth",
    maxDepthTip: "Limits how often a triangle may be recursively split.",
    exportScale: "Export scale",
    exportScaleTip:
      "Scales OBJ coordinates for slicers. GLB/glTF often uses meters; PrusaSlicer usually interprets OBJ coordinates as millimeters.",
    surfaceDetailSources: "Detail sources for subdivision",
    surfaceDetailSourcesTip:
      "The default uses Base Color only. Normal/AO/Roughness can be used as additional geometry indicators, but they are not baked as printable colors.",
    reliefGeometry: "Relief geometry",
    reliefGeometryTip:
      "Experimental: moves vertices using true Height/Bump maps or optionally AO/Roughness proxies. Default is Off.",
    reliefStrength: "Relief strength",
    reliefStrengthTip:
      "Maximum displacement relative to the model diagonal. Start low, because high values can create artifacts.",
    reliefSmoothing: "Relief smoothing",
    reliefSmoothingTip:
      "Smooths relief heights before displacement. Stronger smoothing reduces hard artifacts but loses detail.",
    runBake: "Bake texture to triangles",
    runBakeTip:
      "Runs texture baking with the current colour source, texture resolution, subdivision and bake colour correction settings.",
    baking: "Baking texture…",
    clearBake: "Clear baking",
    clearBakeTip:
      "Clears the baked result while keeping the loaded source model and current baking settings.",
    exportObj: "Export baked vertex OBJ",
    exportObjTip:
      "Exports the baked mesh as an OBJ with vertex colours in v x y z r g b format.",
    exporting: "Exporting…",
    standardNote:
      "Default: Base Color, original texture resolution, slicer-safe detail subdivision, and no relief geometry. The export is a baked OBJ with vertex colors in v x y z r g b format.",
    bakeSummary: "3. Baking summary",
    colorDistribution: "Baked color distribution",
    colorDistributionTip:
      "Shows similar baked colors as a block map. For photo textures this is more useful than a list of individual hex values.",
    diagnostics: "Diagnostics",
    diagnosticsTip:
      "Diagnostics are shown compactly. Details can be expanded when needed; structural mesh problems should be repaired in Blender.",
    showDetails: "Show details",
    hideDetails: "Hide details",
    meshDiagnostics: "Mesh diagnostics",
    topologyCheck: "Wireframe/topology check",
    uvMaterialCheck: "UV/material check",
    notLoaded: "No model loaded yet.",
    ready: "Ready",
    processing: "Processing",
    originalPreview: "Original preview",
    bakedPreview: "Baked color preview",
    loadGlb: "No model loaded.",
    runTextureBaking: "No model loaded.",
    noBakedModel:
      "No baked model. Run texture baking to show the baked preview.",
    progressLoadTitle: "Load model",
    progressBakeTitle: "Texture baking",
    progressExportTitle: "Export baked vertex OBJ",
    progressOrientationTitle: "Orient model",
    progressOrientationPrepare: "Prepare orientation transform",
    progressOrientationApply: "Apply geometry orientation",
    progressOrientationRefresh: "Refresh preview",
    progressReadFiles: "Read files",
    progressSearchZip: "Search ZIP contents",
    progressExtractZip: "Extract model and texture files",
    progressParseModel: "Parse model",
    progressCollectScene: "Collect meshes and scene",
    progressAnalyzeMaterials: "Analyze materials and textures",
    progressPreparePreview: "Prepare preview",
    progressPrepareTextures: "Prepare baking",
    progressPrepareBakeGroup: "Build bake group",
    progressSubdivide: "Slicer-safe subdivision and color baking",
    progressSampleColors: "Apply baked data",
    progressBuildPreview: "Build baked preview",
    progressUpdateStats: "Update statistics",
    progressPrepareGeometry: "Prepare export geometry",
    progressWriteVertexColors: "Write vertex colors",
    progressBuildObj: "Build OBJ file",
    progressDownload: "Prepare download",
    noWarnings: "No warnings.",
    issuesDetected: "Issues detected",
    warningsDetected: "Warnings available",
    textureWorkflowTitle: "Texture Baking",
    handoffToVertex: "Send to VertexColor 2 ColorMix",
    handoffToVertexTip:
      "Passes the baked vertex-colour OBJ directly to VertexColor 2 ColorMix without saving an intermediate file.",
    handoffProgressTitle: "Send baked OBJ",
    handoffProgressStep: "Send to VertexColor 2 ColorMix",
    handoffPreparing: "Preparing handoff…",
    handoffPrepared:
      "Handoff prepared: {faces} faces, {vertices} welded vertices. The baked OBJ was sent to VertexColor 2 ColorMix.",
    handoffFailed: "Handoff failed: {message}",
    visibleExperimentalOption: "Visible material colours · experimental",
    customOption: "Custom",
    subdivisionAdaptiveOption: "Slicer-safe detail subdivision",
    subdivisionOffOption: "Off · existing triangles",
    qualityFastOption: "Fast · 500,000",
    qualityMediumOption: "Medium · 800,000",
    qualityFineOption: "Fine · 1.5M",
    qualityVeryFineOption: "Very fine · 2M",
    scaleNoneOption: "None · ×1",
    surfaceBaseOnlyOption: "Base Color only",
    reliefOffOption: "Off",
    reliefHeightBumpOnlyOption: "Real height/bump/displacement map only",
    reliefAoRoughnessProxyOption: "AO/Roughness as experimental proxy",
    reliefSmoothingOffOption: "Off",
    reliefSmoothingLightOption: "Light",
    reliefSmoothingStrongOption: "Strong",
    bakeColourCorrection: "Bake colour correction",
    bakeColourCorrectionTip:
      "Adjusts texture/material colours before they are baked into vertex colours. UV coordinates are not changed.",
    activeBakeColourCorrection: "Active bake colour correction",
    prepareBakeColourCorrection: "Prepare bake colour correction",
    brightness: "Brightness",
    contrast: "Contrast",
    saturation: "Saturation",
    temperature: "Temperature",
    hue: "Hue",
    tint: "Tint",
    gamma: "Gamma",
    tipBakeBrightness:
      "Adds or removes lightness from texture/material colours before baking. Changes are only applied when you click Apply.",
    tipBakeContrast:
      "Increases or decreases the difference between light and dark texture areas before baking.",
    tipBakeSaturation:
      "Controls colour intensity before baking. Negative values make colours greyer; positive values make them stronger.",
    tipBakeTemperature:
      "Shifts texture colours colder or warmer. Negative values are cooler/bluer; positive values are warmer/yellower-red.",
    tipBakeHue:
      "Rotates hue relative to the source texture colours. 0 means unchanged; -180 and +180 produce the same complementary rotation.",
    tipBakeTint:
      "Shifts the colour cast between green and magenta before baking. Negative values are greener; positive values are more magenta.",
    tipBakeGamma:
      "Changes midtone brightness before baking. 1.0 means unchanged; lower values brighten midtones, higher values darken them.",
    apply: "Apply",
    applyBakeColourCorrectionTip:
      "Applies the pending bake colour correction to the original preview and to the next bake, export and handoff.",
    resetBakeColourCorrectionTip:
      "Resets bake colour correction to neutral values and clears the current baked result.",
    modelOrientation: "Model orientation",
    modelOrientationTip:
      "Rotates the loaded model geometry. Use 90° rotations for coarse axis orientation and fine rotation for small angle corrections. UVs and colours are kept; bake results are cleared because geometry changed.",
    rotate90: "Rotate 90°",
    rotateLeft: "Rotate left",
    rotateRight: "Rotate right",
    rotateForward: "Rotate forward",
    rotateBackward: "Rotate backward",
    fineRotation: "Fine rotation",
    rotationAxis: "Axis",
    rotationAngle: "Angle",
    applyFineRotation: "Apply fine rotation",
    setCurrentOrientation: "Set current orientation",
    resetImportedOrientation: "Reset to imported orientation",
    applyOrientationTip:
      "Applies this 90° rotation to the current model orientation used for preview, diagnostics, baking, OBJ export and handoff.",
    fineRotationTip:
      "Applies the selected degree rotation around the chosen model axis. Use small values for fine alignment corrections.",
    setCurrentOrientationTip:
      "Keeps the current model orientation as the active working orientation and clears the pending fine-rotation value.",
    resetOrientationTip:
      "Restores the loaded model to its original imported orientation and clears the current bake result.",
    orientationCurrent: "Current",
    saveTextureProjectTip:
      "Saves the Texture Baking project settings and optionally embeds the selected source files in the JSON project file.",
    loadTextureProjectTip:
      "Loads a Texture Baking project JSON and restores the selected settings and source files.",
    bakeColourCorrectionApplied:
      "These values are applied during the next texture bake, export and handoff.",
    defaultHints:
      "Default: Base Color, original texture resolution, slicer-safe detail subdivision, and no relief geometry. Export is a baked OBJ with vertex colours in v x y z r g b format.",
  },
};

interface ProgressOverlayState {
  title: string;
  steps: string[];
  activeIndex: number;
  done?: boolean;
  error?: string | null;
}

function ProgressOverlay({
  progress,
}: {
  progress: ProgressOverlayState | null;
}) {
  if (!progress) return null;
  const total = Math.max(1, progress.steps.length);
  const completedCount = progress.done
    ? total
    : Math.max(0, progress.activeIndex);
  const percent = progress.done
    ? 100
    : Math.round((completedCount / total) * 100);
  return (
    <div className="progress-backdrop" role="status" aria-live="polite">
      <div className="progress-card">
        <div className="progress-title-row">
          <strong>{progress.title}</strong>
          <span>{percent}%</span>
        </div>
        <div className="progress-bar">
          <span style={{ width: `${percent}%` }} />
        </div>
        <ul className="progress-steps">
          {progress.steps.map((step, index) => {
            const state =
              progress.error && index === progress.activeIndex
                ? "error"
                : index < completedCount || progress.done
                  ? "done"
                  : index === progress.activeIndex
                    ? "active"
                    : "pending";
            return (
              <li key={`${step}-${index}`} className={state}>
                <span className="step-dot" />
                <span>{step}</span>
              </li>
            );
          })}
        </ul>
        {progress.error && (
          <div className="progress-error">{progress.error}</div>
        )}
      </div>
    </div>
  );
}

function InfoLabel({
  children,
  tip,
}: {
  children: React.ReactNode;
  tip: string;
}) {
  return (
    <span className="info-label" title={tip} aria-label={tip}>
      {children}
    </span>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-CH").format(value);
}

function formatDimension(value: number): string {
  if (!Number.isFinite(value)) return "–";
  if (Math.abs(value) >= 1000) return `${value.toFixed(1)}`;
  if (Math.abs(value) >= 10) return `${value.toFixed(2)}`;
  return `${value.toFixed(4)}`;
}

function formatScaledDimension(value: number, scale: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(scale)) return "–";
  const scaled = value * scale;
  if (Math.abs(scaled) >= 1000) return `${scaled.toFixed(1)}`;
  if (Math.abs(scaled) >= 10) return `${scaled.toFixed(2)}`;
  if (Math.abs(scaled) >= 1) return `${scaled.toFixed(3)}`;
  return `${scaled.toFixed(4)}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "–";
  if (value < 0.1 && value > 0) return "<0.1%";
  return `${value.toFixed(1)}%`;
}

function formatFloat(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "–";
  return value.toFixed(digits);
}

function reliefSourceLabel(source: ReliefSource): string {
  switch (source) {
    case "displacementMap":
      return "Height/Displacement Map";
    case "bumpMap":
      return "Bump Map";
    case "aoMap":
      return "AO map / occlusion channel";
    case "roughnessMap":
      return "Roughness Map / green channel";
    case "metalnessMap":
      return "Metalness-roughness map / blue channel";
    default:
      return "None";
  }
}

function bakeColorModeLabel(mode: BakeColorMode): string {
  switch (mode) {
    case "baseColorEmissive":
      return "Base Color + Emissive";
    case "visibleExperimental":
      return "Visible material colours · experimental";
    default:
      return "Base Color";
  }
}

function textureKLabel(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "–";
  if (size >= 8192) return "8K";
  if (size >= 4096) return "4K";
  if (size >= 2048) return "2K";
  if (size >= 1024) return "1K";
  return `${formatNumber(size)} px`;
}

function textureSizeLabel(maxSize: number | null): string {
  return maxSize
    ? `${textureKLabel(maxSize)} · max. ${formatNumber(maxSize)} px`
    : "Original";
}

function waitForPaint(delayMs = 0): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      if (delayMs > 0) window.setTimeout(resolve, delayMs);
      else resolve();
    });
  });
}

function estimateGeometryMemory(diagnostics: MeshDiagnostics | null): number {
  if (!diagnostics) return 0;
  const positionBytes = diagnostics.vertexCount * 3 * 4;
  const normalBytes = diagnostics.vertexCount * 3 * 4;
  const uvBytes = diagnostics.vertexCount * 2 * 4;
  const colourBytes = diagnostics.vertexCount * 3 * 4;
  const indexBytes = diagnostics.triangleCount * 3 * 4;
  const previewFactor = 2.8;
  return (
    (positionBytes + normalBytes + uvBytes + colourBytes + indexBytes) *
    previewFactor
  );
}

function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

function countPositive(values: number[]): number {
  return values.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0);
}

function formatProblemWarningStatus(
  prefix: string,
  problemAreas: number,
  warningMessages: number,
  successMessage: string,
): string {
  if (problemAreas === 0 && warningMessages === 0) return successMessage;
  const parts: string[] = [];
  if (problemAreas > 0) parts.push(plural(problemAreas, "problem area"));
  if (warningMessages > 0) parts.push(plural(warningMessages, "warning"));
  return `${prefix}: ${parts.join(", ")}.`;
}

function textureDiagnosticsStatus(diagnostics: MeshDiagnostics | null): string {
  if (!diagnostics) return "Diagnostics: no model loaded.";
  const problemAreas = countPositive([
    diagnostics.openEdges,
    diagnostics.nonManifoldEdges,
    diagnostics.degenerateTriangles,
    diagnostics.trianglesWithoutUV,
  ]);
  return formatProblemWarningStatus(
    "Diagnostics",
    problemAreas,
    diagnostics.warnings.length,
    `Diagnostics: ok (${formatNumber(diagnostics.meshCount)} mesh${diagnostics.meshCount === 1 ? "" : "es"}, ${formatNumber(diagnostics.triangleCount)} triangles).`,
  );
}

function textureChecksStatus(report: TextureBakeReport | null): string {
  if (!report) return "Checks: no baked result yet.";
  const problemAreas = countPositive([
    report.bakedOpenEdges,
    report.bakedNonManifoldEdges,
    report.missingUvTriangles,
  ]);
  return formatProblemWarningStatus(
    "Checks",
    problemAreas,
    report.warnings.length,
    `Checks: ok (${formatNumber(report.triangleCount)} triangles, ${formatNumber(report.uniqueColors)} colours).`,
  );
}

type HealthSeverity = "ok" | "warning" | "error" | "neutral";


function transformDiagnosticsBoundingBox(
  diagnostics: MeshDiagnostics | null,
  matrix: OrientationMatrix,
): MeshDiagnostics | null {
  if (!diagnostics?.boundingBox) return diagnostics;
  const { min, max } = diagnostics.boundingBox;
  const sourceCorners: Array<[number, number, number]> = [
    [min[0], min[1], min[2]],
    [min[0], min[1], max[2]],
    [min[0], max[1], min[2]],
    [min[0], max[1], max[2]],
    [max[0], min[1], min[2]],
    [max[0], min[1], max[2]],
    [max[0], max[1], min[2]],
    [max[0], max[1], max[2]],
  ];
  const corners: Array<[number, number, number]> = sourceCorners.map((corner) =>
    applyOrientationMatrixToVec3(corner, matrix),
  );
  const nextMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const nextMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  corners.forEach((corner) => {
    for (let axis = 0; axis < 3; axis += 1) {
      nextMin[axis] = Math.min(nextMin[axis], corner[axis]);
      nextMax[axis] = Math.max(nextMax[axis], corner[axis]);
    }
  });
  const size: [number, number, number] = [
    nextMax[0] - nextMin[0],
    nextMax[1] - nextMin[1],
    nextMax[2] - nextMin[2],
  ];
  return {
    ...diagnostics,
    boundingBox: {
      min: nextMin,
      max: nextMax,
      size,
      diagonal: Math.hypot(size[0], size[1], size[2]),
    },
  };
}

function formatCombinedTextureStatus(
  prefix: string,
  diagnostics: MeshDiagnostics | null,
  report: TextureBakeReport | null,
): string {
  const parts: string[] = [];
  if (diagnostics) parts.push(textureDiagnosticsStatus(diagnostics));
  if (report) parts.push(textureChecksStatus(report));
  return parts.length ? `${prefix} ${parts.join(" ")}` : prefix;
}

function getDiagnosticsSeverity(
  diagnostics: MeshDiagnostics | null,
  hasLoadError: boolean,
): HealthSeverity {
  if (hasLoadError) return "error";
  if (!diagnostics) return "neutral";
  const issueCount =
    diagnostics.openEdges +
    diagnostics.nonManifoldEdges +
    diagnostics.degenerateTriangles +
    diagnostics.trianglesWithoutUV;
  if (issueCount > 0) return "error";
  return diagnostics.warnings.length > 0 ? "warning" : "ok";
}

function getChecksSeverity(
  report: TextureBakeReport | null,
  hasBakeError: boolean,
): HealthSeverity {
  if (hasBakeError) return "error";
  if (!report) return "neutral";
  const issueCount =
    report.bakedOpenEdges +
    report.bakedNonManifoldEdges +
    report.missingUvTriangles;
  if (issueCount > 0) return "error";
  return report.warnings.length > 0 ? "warning" : "ok";
}

function healthSeverityLabel(severity: HealthSeverity): string {
  if (severity === "ok") return "ok";
  if (severity === "warning") return "warnings";
  if (severity === "error") return "errors";
  return "not checked";
}

function getFileExtension(file: File): string {
  const fileName =
    file.name.toLowerCase().replace(/\\/g, "/").split("/").at(-1) ??
    file.name.toLowerCase();
  const parts = fileName.split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

function normaliseAssetName(value: string): string {
  return decodeURIComponent(value)
    .replace(/\\/g, "/")
    .split("/")
    .at(-1)!
    .trim()
    .toLowerCase();
}

function objectUrlMapForFiles(files: File[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) {
    map.set(normaliseAssetName(file.name), URL.createObjectURL(file));
  }
  return map;
}

function revokeObjectUrlMap(urlMap: Map<string, string>) {
  for (const url of urlMap.values()) URL.revokeObjectURL(url);
}

function directoryNameFromFileName(fileName: string): string {
  const cleaned = fileName.replace(/\\/g, "/");
  const slash = cleaned.lastIndexOf("/");
  return slash >= 0 ? cleaned.slice(0, slash).toLowerCase() : "";
}

function findMtlForObj(objFile: File, files: File[]): File | undefined {
  const objTextPromiseKey = "__not_used__";
  void objTextPromiseKey;
  return (
    files.find(
      (file) =>
        getFileExtension(file) === "mtl" &&
        directoryNameFromFileName(file.name) ===
          directoryNameFromFileName(objFile.name),
    ) ?? files.find((file) => getFileExtension(file) === "mtl")
  );
}

async function chooseBestObjFile(files: File[]): Promise<File | undefined> {
  const objFiles = files.filter((file) => getFileExtension(file) === "obj");
  if (objFiles.length <= 1) return objFiles[0];

  let best: { file: File; score: number } | undefined;
  for (const file of objFiles) {
    let score = Math.min(file.size / 1_000_000, 100);
    const directory = directoryNameFromFileName(file.name);
    const sameDirectoryAssets = files.filter(
      (candidate) => directoryNameFromFileName(candidate.name) === directory,
    ).length;
    score += sameDirectoryAssets * 2;
    try {
      const head = (
        await file.slice(0, Math.min(file.size, 256_000)).text()
      ).slice(0, 256_000);
      const mtllibMatch = head.match(/^\s*mtllib\s+(.+)$/im);
      if (mtllibMatch) {
        score += 100;
        const referenced = mtllibMatch[1]?.trim();
        if (
          referenced &&
          files.some(
            (candidate) =>
              getFileExtension(candidate) === "mtl" &&
              normaliseAssetName(candidate.name) ===
                normaliseAssetName(referenced),
          )
        )
          score += 80;
      }
      const faceMatches = head.match(/^\s*f\s+/gim);
      if (faceMatches) score += Math.min(faceMatches.length, 1000) / 20;
    } catch {
      // keep size-/directory-based score
    }
    if (!best || score > best.score) best = { file, score };
  }
  return best?.file;
}

function assignSceneMetadata(
  scene: THREE.Object3D,
  fileName: string,
  sourceKind: string,
) {
  scene.name = fileName;
  scene.userData.sourceKind = sourceKind;
  scene.updateMatrixWorld(true);
}

async function parseGltfAssetFiles(
  files: File[],
  file: File,
): Promise<THREE.Object3D> {
  const extension = getFileExtension(file);
  if (extension !== "glb" && extension !== "gltf") {
    throw new Error(
      "Currently supported inputs are GLB, embedded glTF, and OBJ + MTL + textures.",
    );
  }

  const urlMap = objectUrlMapForFiles(files);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const cleanUrl = url.split(/[?#]/)[0] ?? url;
    const key = normaliseAssetName(cleanUrl);
    return urlMap.get(key) ?? url;
  });

  try {
    const payload =
      extension === "gltf" ? await file.text() : await file.arrayBuffer();
    const loader = new GLTFLoader(manager);

    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(
        payload,
        "",
        (loaded) => resolve(loaded),
        (event) =>
          reject(
            event instanceof Error
              ? event
              : new Error("GLB/glTF could not be read."),
          ),
      );
    });

    assignSceneMetadata(
      gltf.scene,
      file.name,
      extension === "glb" ? "GLB" : "glTF + external files",
    );
    await waitForTextureImages(gltf.scene);
    return gltf.scene;
  } finally {
    window.setTimeout(() => revokeObjectUrlMap(urlMap), 30_000);
  }
}

function collectTextures(object: THREE.Object3D): THREE.Texture[] {
  const textures: THREE.Texture[] = [];
  const textureKeys = [
    "map",
    "normalMap",
    "bumpMap",
    "displacementMap",
    "roughnessMap",
    "metalnessMap",
    "aoMap",
    "emissiveMap",
    "alphaMap",
  ];

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : child.material
        ? [child.material]
        : [];
    for (const material of materials) {
      const record = material as unknown as Record<string, unknown>;
      for (const key of textureKeys) {
        const texture = record[key];
        if (texture instanceof THREE.Texture && !textures.includes(texture)) {
          textures.push(texture);
        }
      }
    }
  });

  return textures;
}

async function waitForTextureImages(object: THREE.Object3D) {
  const textures = collectTextures(object);
  await Promise.all(
    textures.map(
      (texture) =>
        new Promise<void>((resolve) => {
          const image = texture.image as
            | (HTMLImageElement & { complete?: boolean; naturalWidth?: number })
            | HTMLCanvasElement
            | ImageBitmap
            | undefined;
          if (!image) return resolve();
          if ("complete" in image) {
            if (
              image.complete &&
              (image.naturalWidth ?? image.width ?? 0) > 0
            ) {
              return resolve();
            }
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
            return;
          }
          resolve();
        }),
    ),
  );
}

async function parseObjAssetFiles(
  files: File[],
  preferredObjFile?: File,
): Promise<THREE.Object3D> {
  const objFile = preferredObjFile ?? (await chooseBestObjFile(files));
  if (!objFile) throw new Error("No OBJ file found.");

  const objText = await objFile.text();
  const mtllibMatch = objText.match(/^\s*mtllib\s+(.+)$/im);
  const referencedMtlName = mtllibMatch?.[1]?.trim();
  const objDirectory = directoryNameFromFileName(objFile.name);
  const mtlFile = referencedMtlName
    ? (files.find(
        (file) =>
          getFileExtension(file) === "mtl" &&
          directoryNameFromFileName(file.name) === objDirectory &&
          normaliseAssetName(file.name) ===
            normaliseAssetName(referencedMtlName),
      ) ??
      files.find(
        (file) =>
          getFileExtension(file) === "mtl" &&
          normaliseAssetName(file.name) ===
            normaliseAssetName(referencedMtlName),
      ))
    : findMtlForObj(objFile, files);

  const urlMap = objectUrlMapForFiles(files);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const key = normaliseAssetName(url);
    return urlMap.get(key) ?? url;
  });

  try {
    let materials: MTLLoader.MaterialCreator | null = null;
    if (mtlFile) {
      const mtlText = await mtlFile.text();
      const mtlLoader = new MTLLoader(manager);
      materials = mtlLoader.parse(mtlText, "");
      materials.preload();
    }

    const objLoader = new OBJLoader(manager);
    if (materials) objLoader.setMaterials(materials);
    const root = objLoader.parse(objText);
    assignSceneMetadata(
      root,
      objFile.name,
      mtlFile ? "OBJ + MTL + textures" : "OBJ without MTL",
    );
    await waitForTextureImages(root);
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material)
        ? child.material
        : child.material
          ? [child.material]
          : [];
      for (const material of materials) {
        const mat = material as THREE.Material & { map?: THREE.Texture | null };
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      }
    });
    return root;
  } finally {
    window.setTimeout(() => revokeObjectUrlMap(urlMap), 30_000);
  }
}

async function resolveInputFiles(
  fileList: FileList | File[],
): Promise<{
  files: File[];
  archiveCount: number;
  nestedArchiveCount: number;
  skippedArchiveEntries: number;
}> {
  const inputFiles = Array.from(fileList);
  const resolvedFiles: File[] = [];
  let archiveCount = 0;
  let nestedArchiveCount = 0;
  let skippedArchiveEntries = 0;

  for (const file of inputFiles) {
    if (getFileExtension(file) !== "zip") {
      resolvedFiles.push(file);
      continue;
    }
    const extracted = await extractSupportedModelFilesFromZip(file);
    archiveCount += extracted.archiveFiles;
    nestedArchiveCount += extracted.nestedArchiveFiles;
    resolvedFiles.push(...extracted.files);
    skippedArchiveEntries += extracted.skippedFiles;
  }

  return {
    files: resolvedFiles,
    archiveCount,
    nestedArchiveCount,
    skippedArchiveEntries,
  };
}

async function parseModelFiles(
  fileList: FileList | File[],
): Promise<{
  scene: THREE.Object3D;
  mainFile: File;
  sourceSummary: string;
  resolvedFileCount: number;
}> {
  const inputFiles = Array.from(fileList);
  if (inputFiles.length === 0) throw new Error("No file selected.");
  const { files, archiveCount, nestedArchiveCount, skippedArchiveEntries } =
    await resolveInputFiles(inputFiles);
  if (files.length === 0)
    throw new Error(
      "No supported model file found. ZIP imports must contain at least one OBJ or GLB/glTF file.",
    );
  const objFile = await chooseBestObjFile(files);
  const glbFile = files.find((file) =>
    ["glb", "gltf"].includes(getFileExtension(file)),
  );

  if (objFile) {
    const scene = await parseObjAssetFiles(files, objFile);
    const mtlCount = files.filter(
      (file) => getFileExtension(file) === "mtl",
    ).length;
    const textureCount = files.filter((file) =>
      ["png", "jpg", "jpeg", "webp", "bmp", "gif"].includes(
        getFileExtension(file),
      ),
    ).length;
    return {
      scene,
      mainFile: objFile,
      sourceSummary: `${archiveCount ? `ZIP scanned${nestedArchiveCount ? ` (${formatNumber(nestedArchiveCount)} nested)` : ""} · ` : ""}OBJ${mtlCount ? " + MTL" : ""}${textureCount ? ` + ${formatNumber(textureCount)} texture files` : ""}${skippedArchiveEntries ? ` · ${formatNumber(skippedArchiveEntries)} ZIP entries ignored` : ""}`,
      resolvedFileCount: files.length,
    };
  }

  if (glbFile) {
    const scene = await parseGltfAssetFiles(files, glbFile);
    const textureCount = files.filter((file) =>
      ["png", "jpg", "jpeg", "webp", "bmp", "gif"].includes(
        getFileExtension(file),
      ),
    ).length;
    const binCount = files.filter(
      (file) => getFileExtension(file) === "bin",
    ).length;
    return {
      scene,
      mainFile: glbFile,
      sourceSummary: `${archiveCount ? `ZIP scanned${nestedArchiveCount ? ` (${formatNumber(nestedArchiveCount)} nested)` : ""} · ` : ""}${getFileExtension(glbFile) === "glb" ? "GLB" : "glTF"}${binCount ? ` + ${formatNumber(binCount)} BIN` : ""}${textureCount ? ` + ${formatNumber(textureCount)} texture files` : ""}${skippedArchiveEntries ? ` · ${formatNumber(skippedArchiveEntries)} ZIP entries ignored` : ""}`,
      resolvedFileCount: files.length,
    };
  }

  throw new Error(
    "Select a GLB/glTF file, an OBJ with optional MTL and texture files, or a ZIP containing these files.",
  );
}

interface StatRowProps {
  label: string;
  value: string | number;
  danger?: boolean;
  warning?: boolean;
}

function StatRow({
  label,
  value,
  danger = false,
  warning = false,
}: StatRowProps) {
  return (
    <div
      className={danger ? "danger-row" : warning ? "warning-row" : undefined}
    >
      <span>{label}</span>
      <b>{typeof value === "number" ? formatNumber(value) : value}</b>
    </div>
  );
}

const defaultTextureColourCorrection: TextureColourCorrection = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  hue: 0,
  tint: 0,
  gamma: 1,
};

function normaliseTextureColourCorrection(
  value:
    | Partial<TextureColourCorrection>
    | Record<string, unknown>
    | null
    | undefined,
  fallback: TextureColourCorrection = defaultTextureColourCorrection,
): TextureColourCorrection {
  const src = value ?? {};
  const num = (
    key: keyof TextureColourCorrection,
    min: number,
    max: number,
  ): number => {
    const raw = (src as Record<string, unknown>)[key];
    const value = typeof raw === "number" ? raw : Number(raw);
    const fallbackValue = fallback[key];
    return Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : fallbackValue;
  };
  return {
    brightness: Math.round(num("brightness", -100, 100)),
    contrast: Math.round(num("contrast", -100, 100)),
    saturation: Math.round(num("saturation", -100, 100)),
    temperature: Math.round(num("temperature", -100, 100)),
    hue: Math.round(num("hue", -180, 180)),
    tint: Math.round(num("tint", -100, 100)),
    gamma: Math.round(num("gamma", 0.2, 3) * 100) / 100,
  };
}

function sameTextureColourCorrection(
  a: TextureColourCorrection,
  b: TextureColourCorrection,
): boolean {
  return (
    a.brightness === b.brightness &&
    a.contrast === b.contrast &&
    a.saturation === b.saturation &&
    a.temperature === b.temperature &&
    a.hue === b.hue &&
    a.tint === b.tint &&
    Math.abs(a.gamma - b.gamma) < 1e-9
  );
}

function TextureCorrectionSlider({
  label,
  tip,
  value,
  min,
  max,
  step = 1,
  onChange,
  gradient,
}: {
  label: string;
  tip: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  gradient?: "hue" | "tint";
}) {
  return (
    <label
      className={`slider-row texture-correction-row${gradient ? " with-gradient" : ""}`}
    >
      <InfoLabel tip={tip}>{label}</InfoLabel>
      <span className="slider-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          title={tip}
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
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        title={tip}
      />
    </label>
  );
}

function colorSortKey(hex: string): [number, number, number, string] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return [999, 0, 0, hex];
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 1e-9) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const lightness = (max + min) / 2;
  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const neutralGroup = saturation < 0.12 ? 1 : 0;
  return [
    neutralGroup,
    neutralGroup ? lightness * 100 : hue,
    neutralGroup ? 0 : -saturation,
    hex,
  ];
}

function ColorBlockMap({ report }: { report: TextureBakeReport | null }) {
  if (!report) return <p className="muted">No baked colours available yet.</p>;
  if (!report.colorBlocks || report.colorBlocks.length === 0)
    return <p className="muted">No colours detected.</p>;

  const sortedBlocks = [...report.colorBlocks].sort((a, b) => {
    if (a.isRemainder) return 1;
    if (b.isRemainder) return -1;
    const ak = colorSortKey(a.hex);
    const bk = colorSortKey(b.hex);
    return (
      ak[0] - bk[0] ||
      ak[1] - bk[1] ||
      ak[2] - bk[2] ||
      b.count - a.count ||
      ak[3].localeCompare(bk[3])
    );
  });

  return (
    <div className="color-block-section">
      <div className="color-block-meta">
        <span>
          {formatNumber(report.colorBlocks.length)} aggregated colour blocks
        </span>
        <span>Bucket: {report.colorBlockBinSize} RGB levels</span>
        <span>Coverage: {formatPercent(report.colorBlockCoveragePercent)}</span>
      </div>
      <div
        className="color-block-map"
        aria-label="Colour distribution as block map"
      >
        {sortedBlocks.map((entry, index) => (
          <div
            className={`color-block ${entry.isRemainder ? "remainder" : ""}`}
            key={`${entry.hex}-${entry.count}-${index}`}
            style={{
              background: entry.hex,
              gridColumn: `span ${entry.span}`,
              gridRow: `span ${entry.span}`,
            }}
            title={`${entry.isRemainder ? "Remaining colour groups" : entry.hex}: ${formatNumber(entry.count)} triangles · ${formatPercent(entry.percent)}`}
          >
            {entry.span >= 3 && (
              <span>
                <b>{entry.isRemainder ? "Remainder" : entry.hex}</b>
                <em>{formatPercent(entry.percent)}</em>
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="muted note">
        The block map groups similar RGB colours. Block size represents
        frequency; ordering roughly follows the colour spectrum, with neutral
        greys at the end.
      </p>
    </div>
  );
}

type TextureTab =
  | "load"
  | "orientation"
  | "correction"
  | "bake"
  | "export"
  | "checks"
  | "diagnostics"
  | "settings";
type TexturePreviewView =
  | "right"
  | "front"
  | "left"
  | "back"
  | "top"
  | "bottom";
type TexturePreviewBackground = "auto" | "light" | "dark";

interface TextureBakeAppProps {
  onBakedObjHandoff?: (payload: {
    file: File;
    obj: string;
    name: string;
    vertexCount: number;
    faceCount: number;
  }) => void;
  shellTheme?: ShellTheme;
  reloadDataNonce?: number;
  onStatusChange?: (message: string) => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () =>
      reject(reader.error || new Error("File could not be read."));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(
  dataUrl: string,
  name: string,
  type = "application/octet-stream",
): File {
  const parts = dataUrl.split(",");
  const meta = parts[0] || "";
  const payload = parts[1] || "";
  const mimeMatch = meta.match(/^data:([^;]+);base64$/);
  const mime = mimeMatch?.[1] || type || "application/octet-stream";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

function downloadTextFile(
  name: string,
  text: string,
  type = "application/json",
): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function App({
  onBakedObjHandoff,
  onStatusChange,
  shellTheme = "dark",
  reloadDataNonce = 0,
}: TextureBakeAppProps = {}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textureProjectInputRef = useRef<HTMLInputElement | null>(null);
  const lastFilesRef = useRef<File[] | null>(null);
  const baseSceneRef = useRef<THREE.Object3D | null>(null);
  const baseDiagnosticsRef = useRef<MeshDiagnostics | null>(null);
  const orientationMatrixRef = useRef<OrientationMatrix>([
    ...IDENTITY_ORIENTATION_MATRIX,
  ]);
  const language: UiLanguage = "en";
  const t = useCallback(
    (key: TranslationKey) => I18N[language][key],
    [language],
  );
  const darkMode = shellTheme === "dark";
  const [wireframe, setWireframe] = useState(false);
  const [showAxes, setShowAxes] = useState(false);
  const [syncPreviews, setSyncPreviews] = useState(true);
  const [previewView, setPreviewView] = useState<TexturePreviewView>("front");
  const [previewBackground, setPreviewBackground] =
    useState<TexturePreviewBackground>("auto");
  const [previewFitSignal, setPreviewFitSignal] = useState(0);
  const [previewResetSignal, setPreviewResetSignal] = useState(0);
  const [previewRebuildKey, setPreviewRebuildKey] = useState(0);
  const [surfaceDetailMode, setSurfaceDetailMode] =
    useState<SurfaceDetailMode>("baseColorOnly");
  const [bakeColorMode, setBakeColorMode] =
    useState<BakeColorMode>("baseColor");
  const [textureSizeMode, setTextureSizeMode] =
    useState<TextureSizeMode>("original");
  const [customTextureMaxSize, setCustomTextureMaxSize] = useState(1536);
  const [pendingBakeColourCorrection, setPendingBakeColourCorrection] =
    useState<TextureColourCorrection>(defaultTextureColourCorrection);
  const [appliedBakeColourCorrection, setAppliedBakeColourCorrection] =
    useState<TextureColourCorrection>(defaultTextureColourCorrection);
  const [reliefMode, setReliefMode] = useState<ReliefMode>("off");
  const [reliefStrengthPercent, setReliefStrengthPercent] = useState(0.7);
  const [reliefSmoothing, setReliefSmoothing] =
    useState<ReliefSmoothing>("light");
  const [subdivisionMode, setSubdivisionMode] =
    useState<SubdivisionMode>("adaptive");
  const [subdivisionQuality, setSubdivisionQuality] =
    useState<SubdivisionQuality>("medium");
  const [triangleBudget, setTriangleBudget] = useState(800_000);
  const [maxSubdivisionDepth, setMaxSubdivisionDepth] = useState(5);
  const [cameraSyncState, setCameraSyncState] =
    useState<CameraSyncState | null>(null);
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [bakedScene, setBakedScene] = useState<THREE.Object3D | null>(null);
  const [diagnostics, setDiagnostics] = useState<MeshDiagnostics | null>(null);
  const [bakeReport, setBakeReport] = useState<TextureBakeReport | null>(null);
  const [fineRotationAxis, setFineRotationAxis] =
    useState<ModelRotationAxis>("z");
  const [fineRotationAngle, setFineRotationAngle] = useState(0);
  const [fileInfo, setFileInfo] = useState<{
    name: string;
    size: number;
    sourceSummary: string;
    fileCount: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [bakeBusy, setBakeBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [orientationBusy, setOrientationBusy] = useState(false);
  const [exportScale, setExportScale] = useState(1000);
  const [error, setError] = useState<string | null>(null);
  const [bakeError, setBakeError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressOverlayState | null>(null);
  const [activeTextureTab, setActiveTextureTab] = useState<TextureTab>("load");
  const [textureSettingsWidth, setTextureSettingsWidth] = useState(620);
  const [saveTextureProjectParts, setSaveTextureProjectParts] = useState({
    settings: true,
    sourceFiles: true,
  });
  const [loadTextureProjectParts, setLoadTextureProjectParts] = useState({
    settings: true,
    sourceFiles: true,
  });

  const notifyStatus = useCallback(
    (message: string) => {
      onStatusChange?.(message);
    },
    [onStatusChange],
  );

  const diagnosticsStatusMessage = useMemo(
    () => textureDiagnosticsStatus(diagnostics),
    [diagnostics],
  );
  const checksStatusMessage = useMemo(
    () => textureChecksStatus(bakeReport),
    [bakeReport],
  );

  useEffect(() => {
    if (activeTextureTab === "diagnostics")
      notifyStatus(diagnosticsStatusMessage);
    if (activeTextureTab === "checks") notifyStatus(checksStatusMessage);
  }, [
    activeTextureTab,
    checksStatusMessage,
    diagnosticsStatusMessage,
    notifyStatus,
  ]);

  function sceneWithOrientationMatrix(
    baseScene: THREE.Object3D,
    matrix: OrientationMatrix,
  ): THREE.Object3D {
    const clonedSource = baseScene.clone(true);
    const wrapper = new THREE.Group();
    wrapper.name = baseScene.name;
    wrapper.userData = {
      ...baseScene.userData,
      modelOrientationMatrix: matrix,
    };
    wrapper.add(clonedSource);
    const transform = new THREE.Matrix4().set(
      matrix[0], matrix[1], matrix[2], 0,
      matrix[3], matrix[4], matrix[5], 0,
      matrix[6], matrix[7], matrix[8], 0,
      0, 0, 0, 1,
    );
    wrapper.applyMatrix4(transform);
    wrapper.updateMatrixWorld(true);
    return wrapper;
  }

  function setTextureModelOrientationMatrix(
    matrix: OrientationMatrix,
    actionLabel = "orientation updated",
    sourceLabel = "model",
  ): MeshDiagnostics | null {
    const baseScene = baseSceneRef.current;
    if (!baseScene) return null;
    orientationMatrixRef.current = [...matrix];
    const orientedScene = sceneWithOrientationMatrix(baseScene, matrix);
    const report =
      transformDiagnosticsBoundingBox(baseDiagnosticsRef.current, matrix) ??
      analyzeScene(orientedScene, fileInfo?.name ?? baseScene.name ?? "model");
    setScene(orientedScene);
    setDiagnostics(report);
    setBakedScene(null);
    setBakeReport(null);
    setBakeError(null);
    setCameraSyncState(null);
    setPreviewFitSignal((value) => value + 1);
    notifyStatus(
      formatCombinedTextureStatus(
        `Texture Baking: ${sourceLabel} ${actionLabel}.`,
        report,
        null,
      ),
    );
    return report;
  }

  async function runTextureOrientationOperation(
    operation: () => MeshDiagnostics | null,
  ): Promise<MeshDiagnostics | null> {
    const steps = [
      t("progressOrientationPrepare"),
      t("progressOrientationApply"),
      t("progressOrientationRefresh"),
    ];
    setOrientationBusy(true);
    setProgress({ title: t("progressOrientationTitle"), steps, activeIndex: 0 });
    try {
      await waitForPaint(40);
      setProgress({ title: t("progressOrientationTitle"), steps, activeIndex: 1 });
      await waitForPaint(20);
      const report = operation();
      setProgress({ title: t("progressOrientationTitle"), steps, activeIndex: 2 });
      await waitForPaint(20);
      setProgress({
        title: t("progressOrientationTitle"),
        steps,
        activeIndex: steps.length - 1,
        done: true,
      });
      window.setTimeout(() => setProgress(null), 450);
      return report;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProgress({
        title: t("progressOrientationTitle"),
        steps,
        activeIndex: 1,
        error: message,
      });
      notifyStatus("Texture Baking: orientation failed. Details in Model orientation.");
      window.setTimeout(() => setProgress(null), 1200);
      return null;
    } finally {
      setOrientationBusy(false);
    }
  }

  async function applyTextureModelRotation(
    command: ModelRotationCommand,
    sourceLabel = "model",
  ): Promise<MeshDiagnostics | null> {
    const rotation = orientationMatrixForQuarterTurn(command, "negY");
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
    return runTextureOrientationOperation(() =>
      setTextureModelOrientationMatrix(nextMatrix, labels[command], sourceLabel),
    );
  }

  async function applyTextureFineRotation(sourceLabel = "model"): Promise<MeshDiagnostics | null> {
    const angle = Math.round(Math.max(-180, Math.min(180, fineRotationAngle)));
    if (Math.abs(angle) < 0.000001) return null;
    const rotation = orientationMatrixForAxisAngle(fineRotationAxis, angle);
    const nextMatrix = composeOrientationMatrices(
      rotation,
      orientationMatrixRef.current,
    );
    const report = await runTextureOrientationOperation(() =>
      setTextureModelOrientationMatrix(
        nextMatrix,
        `rotated ${angle}° around ${fineRotationAxis.toUpperCase()}`,
        sourceLabel,
      ),
    );
    setFineRotationAngle(0);
    return report;
  }

  function setTextureCurrentOrientation(): void {
    setFineRotationAngle(0);
    notifyStatus("Texture Baking: current orientation set.");
    setPreviewFitSignal((value) => value + 1);
  }

  async function resetTextureModelOrientation(sourceLabel = "model"): Promise<MeshDiagnostics | null> {
    setFineRotationAngle(0);
    return runTextureOrientationOperation(() =>
      setTextureModelOrientationMatrix(
        [...IDENTITY_ORIENTATION_MATRIX],
        "orientation reset to imported state",
        sourceLabel,
      ),
    );
  }

  function applyTextureModelOrientation(
    bottomSide: ModelBottomSide,
    sourceLabel = "model",
  ): MeshDiagnostics | null {
    if (bottomSide === "current") return null;
    const command = orientationMatrixForBottomSide(bottomSide, "negY");
    const nextMatrix = composeOrientationMatrices(
      command,
      orientationMatrixRef.current,
    );
    return setTextureModelOrientationMatrix(
      nextMatrix,
      "orientation restored from project",
      sourceLabel,
    );
  }

  const loadFiles = useCallback(
    async (filesInput: FileList | File[]): Promise<MeshDiagnostics | null> => {
      const files = Array.from(filesInput);
      lastFilesRef.current = files;
      const hasZipInput = files.some(
        (file) => getFileExtension(file) === "zip",
      );
      const steps = [
        t("progressReadFiles"),
        ...(hasZipInput
          ? [t("progressSearchZip"), t("progressExtractZip")]
          : []),
        t("progressParseModel"),
        t("progressCollectScene"),
        t("progressAnalyzeMaterials"),
        t("progressPreparePreview"),
      ];
      setBusy(true);
      setError(null);
      setBakeError(null);
      setBakedScene(null);
      setBakeReport(null);
      setCameraSyncState(null);
      setProgress({ title: t("progressLoadTitle"), steps, activeIndex: 0 });
      try {
        await waitForPaint(40);
        if (hasZipInput) {
          setProgress({ title: t("progressLoadTitle"), steps, activeIndex: 1 });
          await waitForPaint(40);
          setProgress({ title: t("progressLoadTitle"), steps, activeIndex: 2 });
          await waitForPaint(40);
        }
        const parseIndex = hasZipInput ? 3 : 1;
        setProgress({
          title: t("progressLoadTitle"),
          steps,
          activeIndex: parseIndex,
        });
        await waitForPaint(40);
        const parsed = await parseModelFiles(files);
        setProgress({
          title: t("progressLoadTitle"),
          steps,
          activeIndex: parseIndex + 2,
        });
        await waitForPaint(20);
        baseSceneRef.current = parsed.scene;
        orientationMatrixRef.current = [...IDENTITY_ORIENTATION_MATRIX];
        const orientedScene = sceneWithOrientationMatrix(
          parsed.scene,
          orientationMatrixRef.current,
        );
        const report = analyzeScene(orientedScene, parsed.mainFile.name);
        baseDiagnosticsRef.current = report;
        setProgress({
          title: t("progressLoadTitle"),
          steps,
          activeIndex: parseIndex + 3,
        });
        setScene(orientedScene);
        setDiagnostics(report);
            orientationMatrixRef.current = [...IDENTITY_ORIENTATION_MATRIX];
        setFileInfo({
          name: parsed.mainFile.name,
          size: files.reduce((sum, file) => sum + file.size, 0),
          sourceSummary: parsed.sourceSummary,
          fileCount: parsed.resolvedFileCount,
        });
        notifyStatus(
          formatCombinedTextureStatus(
            "Texture Baking: model loaded.",
            report,
            null,
          ),
        );
        setProgress({
          title: t("progressLoadTitle"),
          steps,
          activeIndex: steps.length - 1,
          done: true,
        });
        window.setTimeout(() => setProgress(null), 650);
        return report;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "File could not be loaded.";
        baseSceneRef.current = null;
        baseDiagnosticsRef.current = null;
        setScene(null);
        setBakedScene(null);
        setDiagnostics(null);
        setBakeReport(null);
        setFileInfo(null);
        setError(message);
        notifyStatus("Texture Baking: load failed. Details in Load.");
        setProgress({
          title: t("progressLoadTitle"),
          steps,
          activeIndex: Math.min(steps.length - 1, 1),
          error: message,
        });
        window.setTimeout(() => setProgress(null), 1600);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [notifyStatus, t],
  );

  useEffect(() => {
    if (reloadDataNonce <= 0) return;
    if (!lastFilesRef.current || lastFilesRef.current.length === 0) return;
    void loadFiles(lastFilesRef.current);
  }, [reloadDataNonce, loadFiles]);

  function buildTextureSettingsObject(): Record<string, unknown> {
    return {
      bakeColorMode,
      textureSizeMode,
      customTextureMaxSize,
      appliedBakeColourCorrection,
      pendingBakeColourCorrection,
      surfaceDetailMode,
      reliefMode,
      reliefStrengthPercent,
      reliefSmoothing,
      subdivisionMode,
      subdivisionQuality,
      triangleBudget,
      maxSubdivisionDepth,
      exportScale,
      previewView,
      previewBackground,
      wireframe,
      showAxes,
      syncPreviews,
      modelOrientationMatrix: orientationMatrixRef.current,
    };
  }

  function applyTextureSettingsObject(settings: Record<string, unknown>): void {
    if (
      settings.bakeColorMode === "baseColor" ||
      settings.bakeColorMode === "baseColorEmissive" ||
      settings.bakeColorMode === "visibleExperimental"
    )
      setBakeColorMode(settings.bakeColorMode);
    if (
      settings.textureSizeMode === "original" ||
      settings.textureSizeMode === "8192" ||
      settings.textureSizeMode === "4096" ||
      settings.textureSizeMode === "2048" ||
      settings.textureSizeMode === "1024" ||
      settings.textureSizeMode === "512" ||
      settings.textureSizeMode === "custom"
    )
      setTextureSizeMode(settings.textureSizeMode);
    if (typeof settings.customTextureMaxSize === "number")
      setCustomTextureMaxSize(settings.customTextureMaxSize);
    if (
      settings.appliedBakeColourCorrection &&
      typeof settings.appliedBakeColourCorrection === "object"
    ) {
      const next = normaliseTextureColourCorrection(
        settings.appliedBakeColourCorrection as Record<string, unknown>,
      );
      setAppliedBakeColourCorrection(next);
      setPendingBakeColourCorrection(next);
    }
    if (
      settings.pendingBakeColourCorrection &&
      typeof settings.pendingBakeColourCorrection === "object"
    ) {
      setPendingBakeColourCorrection(
        normaliseTextureColourCorrection(
          settings.pendingBakeColourCorrection as Record<string, unknown>,
          appliedBakeColourCorrection,
        ),
      );
    }
    if (
      settings.surfaceDetailMode === "baseColorOnly" ||
      settings.surfaceDetailMode === "baseColorAndSurfaceMaps"
    )
      setSurfaceDetailMode(settings.surfaceDetailMode);
    if (
      settings.reliefMode === "off" ||
      settings.reliefMode === "heightBumpOnly" ||
      settings.reliefMode === "aoRoughnessProxy"
    )
      setReliefMode(settings.reliefMode);
    if (typeof settings.reliefStrengthPercent === "number")
      setReliefStrengthPercent(settings.reliefStrengthPercent);
    if (
      settings.reliefSmoothing === "off" ||
      settings.reliefSmoothing === "light" ||
      settings.reliefSmoothing === "strong"
    )
      setReliefSmoothing(settings.reliefSmoothing);
    if (
      settings.subdivisionMode === "adaptive" ||
      settings.subdivisionMode === "off"
    )
      setSubdivisionMode(settings.subdivisionMode);
    if (
      settings.subdivisionQuality === "fast" ||
      settings.subdivisionQuality === "medium" ||
      settings.subdivisionQuality === "fine" ||
      settings.subdivisionQuality === "veryFine" ||
      settings.subdivisionQuality === "ultra" ||
      settings.subdivisionQuality === "extreme" ||
      settings.subdivisionQuality === "custom"
    )
      setSubdivisionQuality(settings.subdivisionQuality);
    if (typeof settings.triangleBudget === "number")
      setTriangleBudget(settings.triangleBudget);
    if (typeof settings.maxSubdivisionDepth === "number")
      setMaxSubdivisionDepth(settings.maxSubdivisionDepth);
    if (typeof settings.exportScale === "number")
      setExportScale(settings.exportScale);
    if (
      settings.previewView === "right" ||
      settings.previewView === "front" ||
      settings.previewView === "left" ||
      settings.previewView === "back" ||
      settings.previewView === "top" ||
      settings.previewView === "bottom"
    )
      setPreviewView(settings.previewView);
    if (
      settings.previewBackground === "auto" ||
      settings.previewBackground === "light" ||
      settings.previewBackground === "dark"
    )
      setPreviewBackground(settings.previewBackground);
    if (typeof settings.wireframe === "boolean")
      setWireframe(settings.wireframe);
    if (typeof settings.showAxes === "boolean") setShowAxes(settings.showAxes);
    if (typeof settings.syncPreviews === "boolean")
      setSyncPreviews(settings.syncPreviews);
    if (isOrientationMatrix(settings.modelOrientationMatrix)) {
      const matrix = [...settings.modelOrientationMatrix] as OrientationMatrix;
      if (baseSceneRef.current) {
        setTextureModelOrientationMatrix(
          matrix,
          "orientation restored from project",
          "project",
        );
      } else {
        orientationMatrixRef.current = matrix;
          }
    } else if (isModelBottomSide(settings.modelBottomSide)) {
      if (baseSceneRef.current && settings.modelBottomSide !== "current")
        applyTextureModelOrientation(settings.modelBottomSide, "project");
      else {
            orientationMatrixRef.current = [...IDENTITY_ORIENTATION_MATRIX];
      }
    }
  }

  async function handleSaveTextureProject(): Promise<void> {
    const steps = [
      "Collect settings",
      "Embed source files",
      "Write project JSON",
    ];
    setProgress({
      title: "Save Texture Baking project",
      steps,
      activeIndex: 0,
    });
    await waitForPaint(30);
    const payload: Record<string, unknown> = {
      app: "Color Mix Lab",
      workflow: "Texture Baking",
      version: "0.7.10",
    };
    if (saveTextureProjectParts.settings)
      payload.settings = buildTextureSettingsObject();
    if (saveTextureProjectParts.sourceFiles && lastFilesRef.current?.length) {
      setProgress({
        title: "Save Texture Baking project",
        steps,
        activeIndex: 1,
      });
      payload.sourceFiles = await Promise.all(
        lastFilesRef.current.map(async (file) => ({
          name: file.name,
          type: file.type || "application/octet-stream",
          dataUrl: await fileToDataUrl(file),
        })),
      );
    }
    setProgress({
      title: "Save Texture Baking project",
      steps,
      activeIndex: 2,
    });
    await waitForPaint(20);
    const name = fileInfo?.name
      ? `${fileInfo.name.replace(/\.[^.]+$/, "")}_texture_baking_project.json`
      : "texture_baking_project.json";
    downloadTextFile(name, JSON.stringify(payload, null, 2));
    notifyStatus("Texture Baking: project saved.");
    setProgress({
      title: "Save Texture Baking project",
      steps,
      activeIndex: 2,
      done: true,
    });
    window.setTimeout(() => setProgress(null), 650);
  }

  async function handleLoadTextureProjectFile(file: File): Promise<void> {
    const steps = [
      "Read project JSON",
      "Restore source files",
      "Restore settings",
    ];
    setProgress({
      title: "Load Texture Baking project",
      steps,
      activeIndex: 0,
    });
    try {
      let restoredDiagnostics: MeshDiagnostics | null = null;
      const root = JSON.parse(await file.text()) as Record<string, unknown>;
      await waitForPaint(30);
      if (
        loadTextureProjectParts.sourceFiles &&
        Array.isArray(root.sourceFiles)
      ) {
        setProgress({
          title: "Load Texture Baking project",
          steps,
          activeIndex: 1,
        });
        const files = root.sourceFiles.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [] as File[];
          const record = entry as Record<string, unknown>;
          if (
            typeof record.name !== "string" ||
            typeof record.dataUrl !== "string"
          )
            return [] as File[];
          return [
            dataUrlToFile(
              record.dataUrl,
              record.name,
              typeof record.type === "string"
                ? record.type
                : "application/octet-stream",
            ),
          ];
        });
        if (files.length) restoredDiagnostics = await loadFiles(files);
      }
      if (
        loadTextureProjectParts.settings &&
        root.settings &&
        typeof root.settings === "object"
      ) {
        setProgress({
          title: "Load Texture Baking project",
          steps,
          activeIndex: 2,
        });
        applyTextureSettingsObject(root.settings as Record<string, unknown>);
      }
      notifyStatus(
        formatCombinedTextureStatus(
          "Texture Baking: project loaded.",
          restoredDiagnostics ?? diagnostics,
          bakeReport,
        ),
      );
      setProgress({
        title: "Load Texture Baking project",
        steps,
        activeIndex: steps.length - 1,
        done: true,
      });
      window.setTimeout(() => setProgress(null), 650);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notifyStatus("Texture Baking: project load failed. Details in Load.");
      setProgress({
        title: "Load Texture Baking project",
        steps,
        activeIndex: 0,
        error: message,
      });
      setError(message);
      window.setTimeout(() => setProgress(null), 1600);
    }
  }

  const resolvedTextureMaxSize = useMemo(() => {
    if (textureSizeMode === "original") return null;
    if (textureSizeMode === "custom")
      return Math.max(128, Math.round(customTextureMaxSize));
    return Number(textureSizeMode);
  }, [textureSizeMode, customTextureMaxSize]);

  const runTextureBake = useCallback(async () => {
    if (!scene) return;
    const steps = [
      t("progressPrepareTextures"),
      t("progressPrepareBakeGroup"),
      t("progressSubdivide"),
      t("progressSampleColors"),
      t("progressBuildPreview"),
      t("progressUpdateStats"),
    ];
    setBakeBusy(true);
    setBakeError(null);
    setProgress({ title: t("progressBakeTitle"), steps, activeIndex: 0 });

    try {
      await waitForPaint(60);
      setProgress({ title: t("progressBakeTitle"), steps, activeIndex: 1 });
      await waitForPaint(60);
      setProgress({ title: t("progressBakeTitle"), steps, activeIndex: 2 });
      await waitForPaint(80);
      const result = bakeSceneToFaceColors(scene, {
        subdivisionMode,
        subdivisionQuality,
        includePbrDetails: surfaceDetailMode === "baseColorAndSurfaceMaps",
        topologyMode: "slicerSafe",
        triangleBudget,
        maxSubdivisionDepth,
        reliefEnabled: reliefMode !== "off",
        reliefStrengthPercent,
        reliefSmoothing,
        reliefUsePbrProxy: reliefMode === "aoRoughnessProxy",
        bakeColorMode,
        textureMaxSize: resolvedTextureMaxSize,
        colourCorrection: appliedBakeColourCorrection,
      });
      setProgress({ title: t("progressBakeTitle"), steps, activeIndex: 3 });
      await waitForPaint(30);
      setBakedScene(result.scene);
      setBakeReport(result.report);
      notifyStatus(
        formatCombinedTextureStatus(
          "Texture Baking: bake completed.",
          diagnostics,
          result.report,
        ),
      );
      setProgress({ title: t("progressBakeTitle"), steps, activeIndex: 5 });
      await waitForPaint(30);
      setProgress({
        title: t("progressBakeTitle"),
        steps,
        activeIndex: steps.length - 1,
        done: true,
      });
      window.setTimeout(() => setProgress(null), 650);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Texture baking could not be completed.";
      setBakedScene(null);
      setBakeReport(null);
      setBakeError(message);
      notifyStatus("Texture Baking: bake failed. Details in Bake.");
      setProgress({
        title: t("progressBakeTitle"),
        steps,
        activeIndex: 2,
        error: message,
      });
      window.setTimeout(() => setProgress(null), 1600);
    } finally {
      setBakeBusy(false);
    }
  }, [
    scene,
    subdivisionMode,
    subdivisionQuality,
    surfaceDetailMode,
    triangleBudget,
    maxSubdivisionDepth,
    reliefMode,
    reliefStrengthPercent,
    reliefSmoothing,
    bakeColorMode,
    resolvedTextureMaxSize,
    appliedBakeColourCorrection,
    diagnostics,
    notifyStatus,
    t,
  ]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (files && files.length > 0) void loadFiles(files);
    event.currentTarget.value = "";
  };

  const clearModel = () => {
    lastFilesRef.current = null;
    baseSceneRef.current = null;
    baseDiagnosticsRef.current = null;
    setScene(null);
    setBakedScene(null);
    setDiagnostics(null);
    setBakeReport(null);
    setFileInfo(null);
    setError(null);
    setBakeError(null);
    setCameraSyncState(null);
    notifyStatus("Texture Baking: model cleared.");
  };

  const clearBake = () => {
    setBakedScene(null);
    setBakeReport(null);
    setBakeError(null);
    setCameraSyncState(null);
    notifyStatus("Texture Baking: baked result cleared.");
  };

  const handleCameraSyncChange = useCallback((state: CameraSyncState) => {
    setCameraSyncState(state);
  }, []);

  const exportBakedObj = useCallback(async () => {
    if (!bakedScene || exportBusy) return;
    const steps = [
      t("progressPrepareGeometry"),
      t("progressWriteVertexColors"),
      t("progressBuildObj"),
      t("progressDownload"),
    ];
    setExportBusy(true);
    setBakeError(null);
    setProgress({ title: t("progressExportTitle"), steps, activeIndex: 0 });

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      setProgress({ title: t("progressExportTitle"), steps, activeIndex: 1 });
      const baseName = (fileInfo?.name ?? "baked_model").replace(
        /\.[^.]+$/,
        "",
      );
      const exported = exportBakedSceneToVertexColorObj(
        bakedScene,
        `${baseName}_baked`,
        exportScale,
      );
      setProgress({ title: t("progressExportTitle"), steps, activeIndex: 3 });
      const objName = `${baseName}_baked_vertexcolors.obj`;
      const objBlob = new Blob([exported.obj], {
        type: "text/plain;charset=utf-8",
      });
      downloadBlob(objBlob, objName);
      notifyStatus("Texture Baking: baked OBJ exported.");
      setProgress({
        title: t("progressExportTitle"),
        steps,
        activeIndex: steps.length - 1,
        done: true,
      });
      window.setTimeout(() => setProgress(null), 650);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBakeError(`OBJ export failed: ${message}`);
      notifyStatus("Texture Baking: OBJ export failed. Details in Export.");
      setProgress({
        title: t("progressExportTitle"),
        steps,
        activeIndex: 2,
        error: message,
      });
      window.setTimeout(() => setProgress(null), 1600);
    } finally {
      setExportBusy(false);
    }
  }, [
    bakedScene,
    exportBusy,
    fileInfo?.name,
    exportScale,
    language,
    notifyStatus,
    t,
  ]);

  const handoffBakedObj = useCallback(async () => {
    if (!bakedScene || exportBusy || !onBakedObjHandoff) return;
    const steps = [
      t("progressPrepareGeometry"),
      t("progressWriteVertexColors"),
      t("handoffProgressStep"),
    ];
    setExportBusy(true);
    setBakeError(null);
    setProgress({ title: t("handoffProgressTitle"), steps, activeIndex: 0 });

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      setProgress({ title: t("handoffProgressTitle"), steps, activeIndex: 1 });
      const baseName = (fileInfo?.name ?? "baked_model").replace(
        /\.[^.]+$/,
        "",
      );
      const exported = exportBakedSceneToVertexColorObj(
        bakedScene,
        `${baseName}_baked`,
        exportScale,
      );
      const objName = `${baseName}_baked_vertexcolors.obj`;
      const objFile = new File([exported.obj], objName, {
        type: "text/plain;charset=utf-8",
        lastModified: Date.now(),
      });
      setProgress({ title: t("handoffProgressTitle"), steps, activeIndex: 2 });
      onBakedObjHandoff({
        file: objFile,
        obj: exported.obj,
        name: objName,
        vertexCount: exported.vertexCount,
        faceCount: exported.faceCount,
      });
      notifyStatus(
        t("handoffPrepared")
          .replace("{faces}", formatNumber(exported.faceCount))
          .replace("{vertices}", formatNumber(exported.vertexCount)),
      );
      setProgress({
        title: t("handoffProgressTitle"),
        steps,
        activeIndex: steps.length - 1,
        done: true,
      });
      window.setTimeout(() => setProgress(null), 650);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBakeError(t("handoffFailed").replace("{message}", message));
      notifyStatus("Texture Baking: handoff failed. Details in Export.");
      setProgress({
        title: t("handoffProgressTitle"),
        steps,
        activeIndex: 2,
        error: message,
      });
      window.setTimeout(() => setProgress(null), 1600);
    } finally {
      setExportBusy(false);
    }
  }, [
    bakedScene,
    exportBusy,
    exportScale,
    fileInfo?.name,
    language,
    notifyStatus,
    onBakedObjHandoff,
    t,
  ]);

  const memoryEstimate = estimateGeometryMemory(diagnostics);
  const meshIssueCount = diagnostics
    ? diagnostics.openEdges +
      diagnostics.nonManifoldEdges +
      diagnostics.degenerateTriangles +
      diagnostics.trianglesWithoutUV
    : 0;
  const meshWarningCount = diagnostics
    ? diagnostics.warnings.length + (bakeReport?.warnings.length ?? 0)
    : 0;
  const bakeIssueCount = bakeReport
    ? bakeReport.bakedOpenEdges +
      bakeReport.bakedNonManifoldEdges +
      bakeReport.missingUvTriangles
    : 0;
  const showDiagnosticsOpen = meshIssueCount + bakeIssueCount > 0;
  const diagnosticsSeverity = getDiagnosticsSeverity(
    diagnostics,
    Boolean(error),
  );
  const checksSeverity = getChecksSeverity(bakeReport, Boolean(bakeError));
  const tabHealth: Partial<Record<TextureTab, HealthSeverity>> = {
    diagnostics: diagnosticsSeverity,
    checks: checksSeverity,
  };
  const previewDarkMode =
    previewBackground === "auto" ? darkMode : previewBackground === "dark";
  const hasAnyPreviewModel = Boolean(scene || bakedScene);
  const showOrientationAxisGuide = activeTextureTab === "orientation";

  function handleTextureSettingsResizePointerDown(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = textureSettingsWidth;
    const minWidth = 480;
    const maxWidth = Math.min(980, Math.max(560, window.innerWidth - 540));

    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.round(startWidth + moveEvent.clientX - startX);
      setTextureSettingsWidth(Math.max(minWidth, Math.min(maxWidth, next)));
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

  function handleTextureSettingsResizeReset() {
    setTextureSettingsWidth(620);
  }

  return (
    <div className={`app ${darkMode ? "theme-dark" : "theme-light"}`}>
      <header className="topbar">
        <div>
          <h1>{t("textureWorkflowTitle")}</h1>
          <p>{t("appSubtitle")}</p>
        </div>
      </header>

      <ProgressOverlay progress={progress} />
      <main
        className="layout"
        style={
          {
            "--texture-settings-width": `${textureSettingsWidth}px`,
          } as React.CSSProperties
        }
      >
        <section
          className="panel left-panel tabbed-panel texture-tabbed-panel"
          data-active-tab={activeTextureTab}
        >
          <nav
            className="sidebar-tabs texture-tabs"
            aria-label="Texture Baking workflow sections"
          >
            {(
              [
                [
                  "load",
                  "Load",
                  "Load a GLB, ZIP, or OBJ package with its MTL and texture files.",
                ],
                [
                  "orientation",
                  "Model orientation",
                  "Select which imported model side should face the build plate.",
                ],
                [
                  "correction",
                  "Colour correction",
                  "Adjust texture colours before baking.",
                ],
                [
                  "bake",
                  "Bake",
                  "Bake selected texture channels into vertex or face colours.",
                ],
                [
                  "export",
                  "Export / Handoff",
                  "Export the baked OBJ or send it directly to VertexColor 2 ColorMix.",
                ],
                [
                  "diagnostics",
                  "Diagnostics",
                  "Inspect mesh, topology, UV and material diagnostics.",
                ],
                [
                  "checks",
                  "Checks",
                  "Review the baked result and colour distribution before export or handoff.",
                ],
                [
                  "settings",
                  "Project data",
                  "Save or load the Texture Baking project data and optionally embed the selected source files.",
                ],
              ] as Array<[TextureTab, string, string]>
            ).map(([tabId, label, tip]) => {
              const health = tabHealth[tabId];
              return (
                <button
                  key={tabId}
                  type="button"
                  className={[
                    activeTextureTab === tabId ? "active" : "",
                    health ? "has-health" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setActiveTextureTab(tabId)}
                  title={tip}
                >
                  <span className="sidebar-tab-label">{label}</span>
                  {health && (
                    <span
                      className={`tab-health-dot ${health}`}
                      title={`${label}: ${healthSeverityLabel(health)}`}
                      aria-label={`${label}: ${healthSeverityLabel(health)}`}
                    />
                  )}
                </button>
              );
            })}
          </nav>
          <div className="tab-content texture-tab-content">
            <div className="card texture-section texture-load-section">
              <h2>Load model</h2>
              <p className="workflow-intro">
                Load a GLB, ZIP, or OBJ package with its MTL and texture files.
                Files are selected through the file dialog; drag and drop is
                disabled to keep the workflow consistent.
              </p>
              <label
                className={`file-drop staged-file-picker texture-file-picker ${busy ? "busy" : ""}`}
              >
                <span>GLB, ZIP, or OBJ+MTL+textures</span>
                <strong>
                  {fileInfo?.name ?? (busy ? t("loadingModel") : "Choose file")}
                </strong>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".glb,.gltf,.zip,.obj,.mtl,.png,.jpg,.jpeg,.webp,.bmp,.gif,model/gltf-binary,model/gltf+json,application/zip"
                  multiple
                  onChange={handleInputChange}
                  disabled={busy}
                />
              </label>

              <div className="button-row">
                <button
                  className="secondary"
                  type="button"
                  onClick={clearModel}
                  disabled={!scene || busy}
                >
                  {t("reset")}
                </button>
              </div>

              {fileInfo && (
                <div className="file-summary full">
                  <div>
                    <b>{fileInfo.name}</b>
                  </div>
                  <div>
                    {formatBytes(fileInfo.size)} · {fileInfo.sourceSummary} ·{" "}
                    {formatNumber(fileInfo.fileCount)} file(s) ·{" "}
                    {diagnostics
                      ? `${formatNumber(diagnostics.meshCount)} Meshes`
                      : "–"}
                  </div>
                </div>
              )}

              {error && <div className="error-box">{error}</div>}
            </div>

            <div className="card texture-section texture-orientation-section">
              <h2>{t("modelOrientation")}</h2>
              <p className="workflow-intro">{t("modelOrientationTip")}</p>
              <div className="orientation-panel">
                <div className="section-subtitle">{t("rotate90")}</div>
                <div className="button-row">
                  {([
                    ["left", t("rotateLeft")],
                    ["right", t("rotateRight")],
                    ["forward", t("rotateForward")],
                    ["backward", t("rotateBackward")],
                  ] as Array<[ModelRotationCommand, string]>).map(([command, label]) => (
                    <button
                      key={command}
                      type="button"
                      className="secondary"
                      onClick={() => void applyTextureModelRotation(command)}
                      disabled={!baseSceneRef.current || busy || bakeBusy || exportBusy || orientationBusy}
                      title={t("applyOrientationTip")}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="section-mini-title">{t("fineRotation")}</div>
                <div>
                  <label className="inline-row" title={t("fineRotationTip")}>
                    <InfoLabel tip={t("fineRotationTip")}>
                      {t("rotationAxis")}
                    </InfoLabel>
                    <select
                      value={fineRotationAxis}
                      disabled={!baseSceneRef.current || busy || bakeBusy || exportBusy || orientationBusy}
                      onChange={(event) =>
                        setFineRotationAxis(
                          event.currentTarget.value as ModelRotationAxis,
                        )
                      }
                    >
                      <option value="x">X</option>
                      <option value="y">Y</option>
                      <option value="z">Z</option>
                    </select>
                  </label>
                  <label className="inline-row" title={t("fineRotationTip")}>
                    <InfoLabel tip={t("fineRotationTip")}>
                      {t("rotationAngle")}
                    </InfoLabel>
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      step={1}
                      value={fineRotationAngle}
                      disabled={!baseSceneRef.current || busy || bakeBusy || exportBusy || orientationBusy}
                      onChange={(event) =>
                        setFineRotationAngle(
                          Math.round(
                            Math.max(
                              -180,
                              Math.min(180, Number(event.currentTarget.value) || 0),
                            ),
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() => void applyTextureFineRotation()}
                    disabled={
                      !baseSceneRef.current ||
                      Math.abs(fineRotationAngle) < 0.000001 ||
                      busy ||
                      bakeBusy ||
                      exportBusy ||
                      orientationBusy
                    }
                    title={t("fineRotationTip")}
                  >
                    {t("applyFineRotation")}
                  </button>
                </div>

                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    onClick={setTextureCurrentOrientation}
                    disabled={!baseSceneRef.current || busy || bakeBusy || exportBusy || orientationBusy}
                    title={t("setCurrentOrientationTip")}
                  >
                    {t("setCurrentOrientation")}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void resetTextureModelOrientation("model")}
                    disabled={
                      !baseSceneRef.current ||
                      isIdentityOrientationMatrix(orientationMatrixRef.current) ||
                      busy ||
                      bakeBusy ||
                      exportBusy ||
                      orientationBusy
                    }
                    title={t("resetOrientationTip")}
                  >
                    {t("resetImportedOrientation")}
                  </button>
                </div>
                <div className="muted note">
                  {t("orientationCurrent")}: <b>{t("orientationCurrent")}</b>
                </div>
              </div>
            </div>

            <div className="card texture-section texture-correction-section">
              <h2>{t("bakeColourCorrection")}</h2>
              <p className="workflow-intro">
                Adjust texture colours before baking. These values are applied
                to the original preview, the next bake, exported OBJ files and
                handoff to VertexColor 2 ColorMix.
              </p>

              <div className="active-correction-box texture-correction-summary">
                <b>{t("activeBakeColourCorrection")}</b>
                <div>
                  {t("brightness")}:{" "}
                  <b>{appliedBakeColourCorrection.brightness}</b> ·{" "}
                  {t("contrast")}: <b>{appliedBakeColourCorrection.contrast}</b>{" "}
                  · {t("saturation")}:{" "}
                  <b>{appliedBakeColourCorrection.saturation}</b> ·{" "}
                  {t("temperature")}:{" "}
                  <b>{appliedBakeColourCorrection.temperature}</b> · {t("hue")}:{" "}
                  <b>{appliedBakeColourCorrection.hue}</b> · {t("tint")}:{" "}
                  <b>{appliedBakeColourCorrection.tint}</b> · {t("gamma")}:{" "}
                  <b>{appliedBakeColourCorrection.gamma}</b>
                </div>
                <small>{t("bakeColourCorrectionApplied")}</small>
              </div>
              <h3 className="subhead">{t("prepareBakeColourCorrection")}</h3>
              <TextureCorrectionSlider
                label={t("brightness")}
                tip={t("tipBakeBrightness")}
                value={pendingBakeColourCorrection.brightness}
                min={-100}
                max={100}
                onChange={(value) =>
                  setPendingBakeColourCorrection((prev) => ({
                    ...prev,
                    brightness: value,
                  }))
                }
              />
              <TextureCorrectionSlider
                label={t("contrast")}
                tip={t("tipBakeContrast")}
                value={pendingBakeColourCorrection.contrast}
                min={-100}
                max={100}
                onChange={(value) =>
                  setPendingBakeColourCorrection((prev) => ({
                    ...prev,
                    contrast: value,
                  }))
                }
              />
              <TextureCorrectionSlider
                label={t("saturation")}
                tip={t("tipBakeSaturation")}
                value={pendingBakeColourCorrection.saturation}
                min={-100}
                max={100}
                onChange={(value) =>
                  setPendingBakeColourCorrection((prev) => ({
                    ...prev,
                    saturation: value,
                  }))
                }
              />
              <TextureCorrectionSlider
                label={t("temperature")}
                tip={t("tipBakeTemperature")}
                value={pendingBakeColourCorrection.temperature}
                min={-100}
                max={100}
                onChange={(value) =>
                  setPendingBakeColourCorrection((prev) => ({
                    ...prev,
                    temperature: value,
                  }))
                }
              />
              <TextureCorrectionSlider
                label={t("hue")}
                tip={t("tipBakeHue")}
                value={pendingBakeColourCorrection.hue}
                min={-180}
                max={180}
                gradient="hue"
                onChange={(value) =>
                  setPendingBakeColourCorrection((prev) => ({
                    ...prev,
                    hue: value,
                  }))
                }
              />
              <TextureCorrectionSlider
                label={t("tint")}
                tip={t("tipBakeTint")}
                value={pendingBakeColourCorrection.tint}
                min={-100}
                max={100}
                gradient="tint"
                onChange={(value) =>
                  setPendingBakeColourCorrection((prev) => ({
                    ...prev,
                    tint: value,
                  }))
                }
              />
              <TextureCorrectionSlider
                label={t("gamma")}
                tip={t("tipBakeGamma")}
                value={pendingBakeColourCorrection.gamma}
                min={0.2}
                max={3}
                step={0.05}
                onChange={(value) =>
                  setPendingBakeColourCorrection((prev) => ({
                    ...prev,
                    gamma: Math.round(value * 100) / 100,
                  }))
                }
              />
              <div className="adjustment-actions texture-correction-actions">
                <button
                  type="button"
                  onClick={() => {
                    const next = normaliseTextureColourCorrection(
                      pendingBakeColourCorrection,
                    );
                    setPendingBakeColourCorrection(next);
                    setAppliedBakeColourCorrection(next);
                    setBakedScene(null);
                    setBakeReport(null);
                    setBakeError(null);
                    notifyStatus(
                      "Texture Baking: bake colour correction applied. Bake result cleared.",
                    );
                  }}
                  disabled={
                    sameTextureColourCorrection(
                      pendingBakeColourCorrection,
                      appliedBakeColourCorrection,
                    ) ||
                    busy ||
                    bakeBusy
                  }
                  title={t("applyBakeColourCorrectionTip")}
                >
                  {t("apply")}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setPendingBakeColourCorrection(
                      defaultTextureColourCorrection,
                    );
                    setAppliedBakeColourCorrection(
                      defaultTextureColourCorrection,
                    );
                    setBakedScene(null);
                    setBakeReport(null);
                    setBakeError(null);
                    notifyStatus(
                      "Texture Baking: bake colour correction reset. Bake result cleared.",
                    );
                  }}
                  disabled={
                    (sameTextureColourCorrection(
                      pendingBakeColourCorrection,
                      defaultTextureColourCorrection,
                    ) &&
                      sameTextureColourCorrection(
                        appliedBakeColourCorrection,
                        defaultTextureColourCorrection,
                      )) ||
                    busy ||
                    bakeBusy
                  }
                  title={t("resetBakeColourCorrectionTip")}
                >
                  {t("reset")}
                </button>
              </div>
            </div>

            <div className="card texture-section texture-bake-section">
              <h2>Texture baking</h2>
              <p className="workflow-intro">
                Bake the selected texture channels into vertex or face colours.
                These settings affect the baked OBJ and the object handed off to
                VertexColor 2 ColorMix.
              </p>

              <h3 className="subhead">{t("basis")}</h3>
              <div className="inline-row">
                <InfoLabel tip={t("bakeColorSourcesTip")}>
                  {t("bakeColorSources")}
                </InfoLabel>
                <select
                  value={bakeColorMode}
                  onChange={(event) =>
                    setBakeColorMode(event.currentTarget.value as BakeColorMode)
                  }
                >
                  <option value="baseColor">Base Color</option>
                  <option value="baseColorEmissive">
                    Base Color + Emissive
                  </option>
                  <option value="visibleExperimental">
                    {t("visibleExperimentalOption")}
                  </option>
                </select>
              </div>
              <div className="inline-row">
                <InfoLabel tip={t("textureResolutionTip")}>
                  {t("textureResolution")}
                </InfoLabel>
                <select
                  value={textureSizeMode}
                  onChange={(event) =>
                    setTextureSizeMode(
                      event.currentTarget.value as TextureSizeMode,
                    )
                  }
                >
                  <option value="original">Original</option>
                  <option value="8192">8K · max. 8192 px</option>
                  <option value="4096">4K · max. 4096 px</option>
                  <option value="2048">2K · max. 2048 px</option>
                  <option value="1024">1K · max. 1024 px</option>
                  <option value="512">512 px</option>
                  <option value="custom">{t("customOption")}</option>
                </select>
              </div>
              {textureSizeMode === "custom" && (
                <div className="inline-row">
                  <InfoLabel tip={t("textureResolutionTip")}>
                    {t("customTextureEdge")}
                  </InfoLabel>
                  <input
                    type="number"
                    min={128}
                    max={16384}
                    step={256}
                    value={customTextureMaxSize}
                    onChange={(event) =>
                      setCustomTextureMaxSize(Number(event.currentTarget.value))
                    }
                  />
                </div>
              )}
              {diagnostics && (
                <div className="inline-row subtle-row">
                  <span>{t("sourceResolution")}</span>
                  <b>
                    {diagnostics.baseColorTextureSizeSummary ||
                      diagnostics.textureSourceSizeSummary ||
                      "–"}
                  </b>
                </div>
              )}

              <h3 className="subhead">{t("subdivision")}</h3>
              <div className="inline-row">
                <InfoLabel tip={t("subdivisionModeTip")}>{t("mode")}</InfoLabel>
                <select
                  value={subdivisionMode}
                  onChange={(event) =>
                    setSubdivisionMode(
                      event.currentTarget.value as SubdivisionMode,
                    )
                  }
                >
                  <option value="adaptive">
                    {t("subdivisionAdaptiveOption")}
                  </option>
                  <option value="off">{t("subdivisionOffOption")}</option>
                </select>
              </div>
              <div className="inline-row">
                <InfoLabel tip={t("qualityTip")}>{t("quality")}</InfoLabel>
                <select
                  value={subdivisionQuality}
                  onChange={(event) => {
                    const next = event.currentTarget
                      .value as SubdivisionQuality;
                    setSubdivisionQuality(next);
                    if (next === "fast") {
                      setTriangleBudget(500_000);
                      setMaxSubdivisionDepth(3);
                    }
                    if (next === "medium") {
                      setTriangleBudget(800_000);
                      setMaxSubdivisionDepth(5);
                    }
                    if (next === "fine") {
                      setTriangleBudget(1_500_000);
                      setMaxSubdivisionDepth(7);
                    }
                    if (next === "veryFine") {
                      setTriangleBudget(2_000_000);
                      setMaxSubdivisionDepth(8);
                    }
                    if (next === "ultra") {
                      setTriangleBudget(2_000_000);
                      setMaxSubdivisionDepth(8);
                    }
                    if (next === "extreme") {
                      setTriangleBudget(2_000_000);
                      setMaxSubdivisionDepth(8);
                    }
                  }}
                  disabled={subdivisionMode === "off"}
                >
                  <option value="fast">{t("qualityFastOption")}</option>
                  <option value="medium">{t("qualityMediumOption")}</option>
                  <option value="fine">{t("qualityFineOption")}</option>
                  <option value="veryFine">{t("qualityVeryFineOption")}</option>
                  <option value="custom">{t("customOption")}</option>
                </select>
              </div>
              {subdivisionQuality === "custom" && (
                <>
                  <div className="inline-row">
                    <InfoLabel tip={t("triangleBudgetTip")}>
                      {t("triangleBudget")}
                    </InfoLabel>
                    <select
                      value={triangleBudget}
                      onChange={(event) => {
                        setTriangleBudget(Number(event.currentTarget.value));
                        setSubdivisionQuality("custom");
                      }}
                      disabled={subdivisionMode === "off"}
                    >
                      <option value={500000}>500’000</option>
                      <option value={800000}>800’000</option>
                      <option value={1500000}>1’500’000</option>
                      <option value={2000000}>2’000’000</option>
                      <option value={2000000}>2’000’000</option>
                    </select>
                  </div>
                  <div className="inline-row">
                    <InfoLabel tip={t("maxDepthTip")}>
                      {t("maxDepth")}
                    </InfoLabel>
                    <input
                      className="number-input"
                      type="number"
                      min={0}
                      max={8}
                      value={maxSubdivisionDepth}
                      disabled={subdivisionMode === "off"}
                      onChange={(event) => {
                        setMaxSubdivisionDepth(
                          Number(event.currentTarget.value),
                        );
                        setSubdivisionQuality("custom");
                      }}
                    />
                  </div>
                </>
              )}

              <details className="advanced-options">
                <summary>{t("advancedOptions")}</summary>
                <div className="inline-row">
                  <InfoLabel tip={t("surfaceDetailSourcesTip")}>
                    {t("surfaceDetailSources")}
                  </InfoLabel>
                  <select
                    value={surfaceDetailMode}
                    onChange={(event) =>
                      setSurfaceDetailMode(
                        event.currentTarget.value as SurfaceDetailMode,
                      )
                    }
                    disabled={subdivisionMode === "off"}
                  >
                    <option value="baseColorOnly">
                      {t("surfaceBaseOnlyOption")}
                    </option>
                    <option value="baseColorAndSurfaceMaps">
                      Base Color + Normal/AO/Roughness
                    </option>
                  </select>
                </div>
                <div className="inline-row">
                  <InfoLabel tip={t("reliefGeometryTip")}>
                    {t("reliefGeometry")}
                  </InfoLabel>
                  <select
                    value={reliefMode}
                    onChange={(event) =>
                      setReliefMode(event.currentTarget.value as ReliefMode)
                    }
                  >
                    <option value="off">{t("reliefOffOption")}</option>
                    <option value="heightBumpOnly">
                      {t("reliefHeightBumpOnlyOption")}
                    </option>
                    <option value="aoRoughnessProxy">
                      {t("reliefAoRoughnessProxyOption")}
                    </option>
                  </select>
                </div>
                <div className="inline-row">
                  <InfoLabel tip={t("reliefStrengthTip")}>
                    {t("reliefStrength")}
                  </InfoLabel>
                  <select
                    value={reliefStrengthPercent}
                    onChange={(event) =>
                      setReliefStrengthPercent(
                        Number(event.currentTarget.value),
                      )
                    }
                    disabled={reliefMode === "off"}
                  >
                    <option value={0.25}>0.25%</option>
                    <option value={0.5}>0.5%</option>
                    <option value={0.7}>0.7%</option>
                    <option value={1}>1.0%</option>
                    <option value={2}>2.0%</option>
                  </select>
                </div>
                <div className="inline-row">
                  <InfoLabel tip={t("reliefSmoothingTip")}>
                    {t("reliefSmoothing")}
                  </InfoLabel>
                  <select
                    value={reliefSmoothing}
                    onChange={(event) =>
                      setReliefSmoothing(
                        event.currentTarget.value as ReliefSmoothing,
                      )
                    }
                    disabled={reliefMode === "off"}
                  >
                    <option value="off">{t("reliefOffOption")}</option>
                    <option value="light">
                      {t("reliefSmoothingLightOption")}
                    </option>
                    <option value="strong">
                      {t("reliefSmoothingStrongOption")}
                    </option>
                  </select>
                </div>
                <p className="muted note compact-note">
                  Normal, AO, roughness and relief options are not active by
                  default. They are experimental geometry or subdivision
                  indicators only.
                </p>
              </details>

              {diagnostics && diagnostics.triangleCount > triangleBudget && (
                <ul className="warning-list compact">
                  <li>
                    Input mesh exceeds the selected triangle budget: {formatNumber(diagnostics.triangleCount)} → target {formatNumber(triangleBudget)}. Consider reducing the model externally before baking.
                  </li>
                </ul>
              )}

              <div className="texture-action-grid">
                <button
                  type="button"
                  onClick={runTextureBake}
                  disabled={!scene || busy || bakeBusy || exportBusy || orientationBusy}
                  title={t("runBakeTip")}
                >
                  {bakeBusy ? t("baking") : t("runBake")}
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={clearBake}
                  disabled={!bakedScene || bakeBusy || exportBusy}
                  title={t("clearBakeTip")}
                >
                  {t("clearBake")}
                </button>
              </div>
              <p className="muted note">{t("standardNote")}</p>
              {bakeError && <div className="error-box">{bakeError}</div>}
            </div>

            <div className="card texture-section texture-export-section">
              <h2>Export / handoff</h2>
              <p className="workflow-intro">
                Export the baked OBJ as a separate file or send it directly to
                VertexColor 2 ColorMix. Check the export scale here before
                continuing.
              </p>
              {diagnostics?.boundingBox && (
                <div className="file-summary full texture-scale-summary">
                  <div>
                    <b>Scale preview</b>
                  </div>
                  {fileInfo?.name && <div>Source: {fileInfo.name}</div>}
                  <div>
                    Raw size:{" "}
                    {diagnostics.boundingBox.size
                      .map(formatDimension)
                      .join(" × ")}
                  </div>
                  <div>
                    Export size:{" "}
                    {diagnostics.boundingBox.size
                      .map((value) => formatScaledDimension(value, exportScale))
                      .join(" × ")}{" "}
                    mm
                  </div>
                </div>
              )}
              <div className="inline-row">
                <InfoLabel tip={t("exportScaleTip")}>
                  {t("exportScale")}
                </InfoLabel>
                <select
                  value={exportScale}
                  onChange={(event) =>
                    setExportScale(Number(event.currentTarget.value))
                  }
                >
                  <option value={1}>{t("scaleNoneOption")}</option>
                  <option value={10}>cm → mm · ×10</option>
                  <option value={100}>dm → mm · ×100</option>
                  <option value={1000}>m → mm · ×1000</option>
                </select>
              </div>
              <div className="texture-action-grid">
                <button
                  className="secondary"
                  type="button"
                  onClick={exportBakedObj}
                  disabled={!bakedScene || bakeBusy || exportBusy}
                  title={t("exportObjTip")}
                >
                  {exportBusy ? t("exporting") : t("exportObj")}
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={handoffBakedObj}
                  disabled={
                    !bakedScene || bakeBusy || exportBusy || !onBakedObjHandoff
                  }
                  title={t("handoffToVertexTip")}
                >
                  {t("handoffToVertex")}
                </button>
              </div>
              <p className="muted note">
                Handoff uses the same baked OBJ without saving an intermediate
                file.
              </p>
            </div>

            <div className="card texture-section texture-checks-section">
              <h2>Checks</h2>
              <p className="workflow-intro">
                Review the baked result and colour distribution before exporting
                or handing off the model.
              </p>
              {!bakeReport ? (
                <p className="muted">
                  No model baked yet. Load a model and run Texture Baking to
                  show the checks.
                </p>
              ) : (
                <>
                  <div className="stats">
                    <StatRow
                      label="Source meshes"
                      value={bakeReport.meshCount}
                    />
                    <StatRow
                      label="Original triangles"
                      value={bakeReport.triangleCount}
                    />
                    <StatRow
                      label="Output triangles"
                      value={bakeReport.outputTriangles}
                      warning={bakeReport.outputTriangles > 800_000}
                    />
                    <StatRow
                      label="Bake colour source"
                      value={bakeColorModeLabel(bakeReport.bakeColorMode)}
                    />
                    <StatRow
                      label="Texture resolution"
                      value={`${textureSizeLabel(bakeReport.textureMaxSize)} · source ${textureKLabel(bakeReport.originalTextureMaxSize)} · effective ${textureKLabel(bakeReport.effectiveTextureMaxSize)}`}
                      warning={Boolean(bakeReport.textureMaxSize)}
                    />
                    <StatRow
                      label="Subdivision"
                      value={
                        bakeReport.subdivisionMode === "off"
                          ? "Off"
                          : `${formatFloat(bakeReport.subdivisionFactor, 2)}×`
                      }
                      warning={bakeReport.subdivisionFactor > 50}
                    />
                    <StatRow
                      label="Budget reached"
                      value={bakeReport.budgetLimitReached ? "Yes" : "No"}
                      warning={bakeReport.budgetLimitReached}
                    />
                    <StatRow
                      label="Sampled from texture"
                      value={bakeReport.texturedTriangles}
                      warning={bakeReport.texturedTriangles === 0}
                    />
                    <StatRow
                      label="Triangles without UV"
                      value={bakeReport.missingUvTriangles}
                      danger={bakeReport.missingUvTriangles > 0}
                    />
                    <StatRow
                      label="Unique colours"
                      value={bakeReport.uniqueColors}
                      warning={bakeReport.uniqueColors > 256}
                    />
                    <StatRow
                      label="Baked open edges"
                      value={bakeReport.bakedOpenEdges}
                      danger={bakeReport.bakedOpenEdges > 0}
                    />
                    <StatRow
                      label="Baked non-manifold edges"
                      value={bakeReport.bakedNonManifoldEdges}
                      danger={bakeReport.bakedNonManifoldEdges > 0}
                    />
                    <StatRow
                      label="Estimated baked geometry"
                      value={formatBytes(
                        bakeReport.estimatedBakedGeometryBytes,
                      )}
                      warning={
                        bakeReport.estimatedBakedGeometryBytes >
                        800 * 1024 * 1024
                      }
                    />
                    {bakeReport.reliefEnabled && (
                      <>
                        <StatRow
                          label="Relief source"
                          value={reliefSourceLabel(bakeReport.reliefSource)}
                        />
                        <StatRow
                          label="Relief vertices moved"
                          value={bakeReport.reliefAffectedVertices}
                        />
                        <StatRow
                          label="Max. relief displacement"
                          value={formatDimension(
                            bakeReport.reliefMaxDisplacement,
                          )}
                        />
                      </>
                    )}
                  </div>
                  {bakeReport.warnings.length > 0 && (
                    <ul className="warning-list compact">
                      {bakeReport.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            {bakeReport && (
              <details className="card collapsible-card texture-section texture-checks-section">
                <summary>
                  <InfoLabel tip={t("colorDistributionTip")}>
                    {t("colorDistribution")}
                  </InfoLabel>
                </summary>
                <ColorBlockMap report={bakeReport} />
              </details>
            )}

            <div className="card diagnostics-card texture-section texture-diagnostics-section">
              <h2>Diagnostics</h2>
              <p className="workflow-intro">
                Use diagnostics for mesh, topology, UV and material issues.
                Structural problems should usually be repaired before baking.
              </p>
              {!diagnostics ? (
                <p className="muted">{t("notLoaded")}</p>
              ) : (
                <>
                  <div className="diagnostic-summary">
                    <span className="muted">
                      Meshes {formatNumber(diagnostics.meshCount)} · triangles{" "}
                      {formatNumber(diagnostics.triangleCount)} · open edges{" "}
                      {formatNumber(diagnostics.openEdges)} · non-manifold{" "}
                      {formatNumber(diagnostics.nonManifoldEdges)}
                    </span>
                  </div>

                  {(diagnostics.warnings.length > 0 ||
                    bakeReport?.warnings.length) && (
                    <ul className="warning-list compact">
                      {diagnostics.warnings.slice(0, 4).map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                      {bakeReport?.warnings.slice(0, 3).map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}

                  <details
                    className="diagnostic-details"
                    open={showDiagnosticsOpen}
                  >
                    <summary>
                      {showDiagnosticsOpen
                        ? t("hideDetails")
                        : t("showDetails")}
                    </summary>

                    <h3>{t("meshDiagnostics")}</h3>
                    <div className="stats">
                      <StatRow label="Meshes" value={diagnostics.meshCount} />
                      <StatRow
                        label="Skinned Meshes"
                        value={diagnostics.skinnedMeshCount}
                        warning={diagnostics.skinnedMeshCount > 0}
                      />
                      <StatRow
                        label="Vertices"
                        value={diagnostics.vertexCount}
                      />
                      <StatRow
                        label="Unique positions"
                        value={diagnostics.uniquePositionCount}
                      />
                      <StatRow
                        label="Duplicate positions / UV seams"
                        value={diagnostics.duplicatePositionCount}
                      />
                      <StatRow
                        label="Triangles"
                        value={diagnostics.triangleCount}
                        warning={diagnostics.triangleCount > 800_000}
                      />
                      <StatRow
                        label="Estimated memory"
                        value={formatBytes(memoryEstimate)}
                        warning={memoryEstimate > 800 * 1024 * 1024}
                      />
                    </div>

                    <h3>{t("topologyCheck")}</h3>
                    <div className="stats">
                      <StatRow
                        label="Total edges"
                        value={diagnostics.totalEdges}
                      />
                      <StatRow
                        label="Open edges"
                        value={diagnostics.openEdges}
                        danger={diagnostics.openEdges > 0}
                      />
                      <StatRow
                        label="Non-manifold edges"
                        value={diagnostics.nonManifoldEdges}
                        danger={diagnostics.nonManifoldEdges > 0}
                      />
                      <StatRow
                        label="Degenerate triangles"
                        value={diagnostics.degenerateTriangles}
                        danger={diagnostics.degenerateTriangles > 0}
                      />
                      <StatRow
                        label="Very thin triangles"
                        value={diagnostics.thinTriangles}
                        warning={diagnostics.thinTriangles > 0}
                      />
                      <StatRow
                        label="Duplicate faces"
                        value={diagnostics.duplicateFaces}
                        warning={diagnostics.duplicateFaces > 0}
                      />
                    </div>

                    <h3>{t("uvMaterialCheck")}</h3>
                    <div className="stats">
                      <StatRow
                        label="Materials"
                        value={diagnostics.materialCount}
                      />
                      <StatRow
                        label="Base-colour textures"
                        value={diagnostics.textureCount}
                        warning={diagnostics.textureCount === 0}
                      />
                      <StatRow
                        label="Base-colour resolution"
                        value={diagnostics.baseColorTextureSizeSummary || "–"}
                        warning={diagnostics.baseColorTextureMaxSize > 4096}
                      />
                      <StatRow
                        label="Other texture resolutions"
                        value={diagnostics.textureSourceSizeSummary || "–"}
                        warning={diagnostics.textureSourceMaxSize > 4096}
                      />
                      <StatRow
                        label="Additional maps"
                        value={`Emissive ${formatNumber(diagnostics.emissiveMapCount)} · Alpha ${formatNumber(diagnostics.alphaMapCount)} · Normal ${formatNumber(diagnostics.normalMapCount)} · AO/Roughness ${formatNumber(diagnostics.aoMapCount + diagnostics.roughnessMapCount)}`}
                        warning={
                          diagnostics.emissiveMapCount +
                            diagnostics.alphaMapCount +
                            diagnostics.normalMapCount +
                            diagnostics.aoMapCount +
                            diagnostics.roughnessMapCount >
                          0
                        }
                      />
                      <StatRow
                        label="Transparency / special material"
                        value={`transparent ${formatNumber(diagnostics.transparentMaterialCount)} · Transmission ${formatNumber(diagnostics.transmissionMaterialCount)} · Clearcoat ${formatNumber(diagnostics.clearcoatMaterialCount)}`}
                        warning={
                          diagnostics.transparentMaterialCount +
                            diagnostics.transmissionMaterialCount +
                            diagnostics.clearcoatMaterialCount >
                          0
                        }
                      />
                      <StatRow
                        label="Meshes with UV"
                        value={diagnostics.meshesWithUV}
                      />
                      <StatRow
                        label="Meshes without UV"
                        value={diagnostics.meshesWithoutUV}
                        danger={diagnostics.meshesWithoutUV > 0}
                      />
                      <StatRow
                        label="Triangles without UV"
                        value={diagnostics.trianglesWithoutUV}
                        danger={diagnostics.trianglesWithoutUV > 0}
                      />
                      <StatRow
                        label="UV outside 0–1"
                        value={diagnostics.trianglesWithUVOutside01}
                        warning={diagnostics.trianglesWithUVOutside01 > 0}
                      />
                    </div>
                  </details>
                </>
              )}
            </div>
            {activeTextureTab === "settings" && (
              <div className="card texture-section texture-settings-section">
                <h2>Project data</h2>
                <p className="workflow-intro">
                  Save or load the Texture Baking project data. The project file
                  can contain the baking settings and the selected source model
                  package.
                </p>

                <div className="project-settings-grid">
                  <div className="project-settings-group">
                    <h3>Save contents</h3>
                    <label className="checkbox-row compact">
                      <input
                        type="checkbox"
                        checked={saveTextureProjectParts.settings}
                        onChange={(event) =>
                          setSaveTextureProjectParts((prev) => ({
                            ...prev,
                            settings: event.currentTarget.checked,
                          }))
                        }
                      />
                      <span>Baking settings</span>
                    </label>
                    <label className="checkbox-row compact">
                      <input
                        type="checkbox"
                        checked={saveTextureProjectParts.sourceFiles}
                        onChange={(event) =>
                          setSaveTextureProjectParts((prev) => ({
                            ...prev,
                            sourceFiles: event.currentTarget.checked,
                          }))
                        }
                      />
                      <span>Source model/files</span>
                    </label>
                  </div>
                  <div className="project-settings-group">
                    <h3>Load contents</h3>
                    <label className="checkbox-row compact">
                      <input
                        type="checkbox"
                        checked={loadTextureProjectParts.settings}
                        onChange={(event) =>
                          setLoadTextureProjectParts((prev) => ({
                            ...prev,
                            settings: event.currentTarget.checked,
                          }))
                        }
                      />
                      <span>Baking settings</span>
                    </label>
                    <label className="checkbox-row compact">
                      <input
                        type="checkbox"
                        checked={loadTextureProjectParts.sourceFiles}
                        onChange={(event) =>
                          setLoadTextureProjectParts((prev) => ({
                            ...prev,
                            sourceFiles: event.currentTarget.checked,
                          }))
                        }
                      />
                      <span>Source model/files</span>
                    </label>
                  </div>
                </div>

                <p className="muted note">
                  Source files are embedded directly in the JSON project file
                  when selected. Large GLB/ZIP/OBJ packages can therefore make
                  the project file large.
                </p>

                <div className="settings-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void handleSaveTextureProject()}
                    disabled={busy || bakeBusy || exportBusy || orientationBusy}
                    title={t("saveTextureProjectTip")}
                  >
                    Save project
                  </button>
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => textureProjectInputRef.current?.click()}
                    disabled={busy || bakeBusy || exportBusy || orientationBusy}
                    title={t("loadTextureProjectTip")}
                  >
                    Load project
                  </button>
                  <input
                    ref={textureProjectInputRef}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void handleLoadTextureProjectFile(file);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        <div
          className="layout-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Texture Baking settings panel"
          title="Drag to resize; double-click to reset"
          onPointerDown={handleTextureSettingsResizePointerDown}
          onDoubleClick={handleTextureSettingsResizeReset}
        />

        <section className="preview-panel panel">
          <div className="preview-surface-card texture-preview-surface-card">
            <div className="preview-toolbar preview-toolbar-merged">
              <div className="preview-toolbar-main">
                <div className="preview-control-row">
                  <label>
                    <InfoLabel tip={t("viewTip")}>{t("view")}</InfoLabel>
                    <select
                      value={previewView}
                      disabled={!hasAnyPreviewModel}
                      onChange={(event) => {
                        const nextView = event.currentTarget
                          .value as TexturePreviewView;
                        setCameraSyncState(null);
                        setPreviewView(nextView);
                        setPreviewResetSignal((value) => value + 1);
                      }}
                    >
                      <option value="right">Right</option>
                      <option value="front">Front</option>
                      <option value="left">Left</option>
                      <option value="back">Back</option>
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </label>
                  <label title="Sets the preview background independently from the UI theme.">
                    <InfoLabel tip="Sets the preview background independently from the UI theme.">
                      Background
                    </InfoLabel>
                    <select
                      value={previewBackground}
                      onChange={(event) =>
                        setPreviewBackground(
                          event.currentTarget.value as TexturePreviewBackground,
                        )
                      }
                    >
                      <option value="auto">GUI theme</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={wireframe}
                      disabled={!hasAnyPreviewModel}
                      onChange={(event) =>
                        setWireframe(event.currentTarget.checked)
                      }
                    />
                    <InfoLabel tip={t("wireframeTip")}>Wireframe</InfoLabel>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={showAxes}
                      disabled={!hasAnyPreviewModel}
                      onChange={(event) =>
                        setShowAxes(event.currentTarget.checked)
                      }
                    />
                    <InfoLabel tip={t("axesTip")}>{t("axes")}</InfoLabel>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={syncPreviews}
                      disabled={!hasAnyPreviewModel}
                      onChange={(event) =>
                        setSyncPreviews(event.currentTarget.checked)
                      }
                    />
                    <InfoLabel tip={t("syncViewsTip")}>Sync</InfoLabel>
                  </label>
                  <button
                    className="secondary compact"
                    type="button"
                    disabled={!hasAnyPreviewModel}
                    onClick={() => setPreviewFitSignal((value) => value + 1)}
                    title={t("fitToModelTip")}
                  >
                    {t("fitToModel")}
                  </button>
                  <button
                    className="secondary compact"
                    type="button"
                    disabled={!hasAnyPreviewModel}
                    onClick={() => setPreviewResetSignal((value) => value + 1)}
                    title={t("resetViewTip")}
                  >
                    {t("resetView")}
                  </button>
                  <button
                    className="secondary compact"
                    type="button"
                    disabled={!hasAnyPreviewModel}
                    onClick={() => setPreviewRebuildKey((value) => value + 1)}
                    title={t("rebuildPreviewTip")}
                  >
                    {t("rebuildPreview")}
                  </button>
                </div>
              </div>
            </div>
            <div className="preview-content-scroll texture-preview-content">
              <div className="preview-grid">
                <div className="preview-cell">
                  <div className="preview-cell-title">
                    {t("originalPreview")}
                  </div>
                  <ModelPreview
                    key={`original-${previewRebuildKey}-${previewBackground}`}
                    scene={scene}
                    wireframe={wireframe}
                    showAxes={showAxes || showOrientationAxisGuide}
                    showAxisLabels={showOrientationAxisGuide}
                    view={previewView}
                    fitSignal={previewFitSignal}
                    resetSignal={previewResetSignal}
                    darkMode={previewDarkMode}
                    label="Original GLB"
                    emptyText={t("loadGlb")}
                    syncId="original"
                    syncEnabled={syncPreviews}
                    syncState={cameraSyncState}
                    onSyncChange={handleCameraSyncChange}
                    colourCorrection={appliedBakeColourCorrection}
                  />
                </div>
                <div className="preview-cell">
                  <div className="preview-cell-title">{t("bakedPreview")}</div>
                  <ModelPreview
                    key={`baked-${previewRebuildKey}-${previewBackground}`}
                    scene={bakedScene}
                    wireframe={wireframe}
                    showAxes={showAxes || showOrientationAxisGuide}
                    showAxisLabels={showOrientationAxisGuide}
                    view={previewView}
                    fitSignal={previewFitSignal}
                    resetSignal={previewResetSignal}
                    darkMode={previewDarkMode}
                    label={
                      bakeReport?.reliefEnabled &&
                      bakeReport.reliefSource !== "none"
                        ? "Baked Face Colors + Geometry Relief"
                        : "Baked Face Colors"
                    }
                    emptyText={
                      scene ? t("noBakedModel") : t("runTextureBaking")
                    }
                    syncId="baked"
                    syncEnabled={syncPreviews}
                    syncState={cameraSyncState}
                    onSyncChange={handleCameraSyncChange}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
