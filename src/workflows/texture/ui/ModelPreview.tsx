import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { applyTextureColourCorrection, type TextureColourCorrection } from "../core/textureBake";

export interface CameraSyncState {
  sourceId: string;
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

type PreviewView = "right" | "front" | "left" | "back" | "top" | "bottom";

const AXIS_LABEL_DEFINITIONS = [
  { key: "posX", label: "+X", className: "axis-label-x" },
  { key: "negX", label: "-X", className: "axis-label-x" },
  { key: "posY", label: "+Y", className: "axis-label-y" },
  { key: "negY", label: "-Y", className: "axis-label-y" },
  { key: "posZ", label: "+Z", className: "axis-label-z" },
  { key: "negZ", label: "-Z", className: "axis-label-z" },
] as const;

type AxisLabelKey = (typeof AXIS_LABEL_DEFINITIONS)[number]["key"];

type AxisLabelRefs = Partial<Record<AxisLabelKey, HTMLSpanElement | null>>;

interface AxisGuideGeometry {
  positions: Float32Array;
  colors: Float32Array;
  labels: Record<AxisLabelKey, THREE.Vector3>;
}

const PREVIEW_LIGHT_BACKGROUND = 0x9a9a9a;
const PREVIEW_DARK_BACKGROUND = 0x20242a;

let lightBackgroundTexture: THREE.CanvasTexture | null = null;
let darkBackgroundTexture: THREE.CanvasTexture | null = null;

function makeBackgroundTexture(top: string, bottom: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function previewBackground(darkMode: boolean): THREE.CanvasTexture {
  if (darkMode) {
    if (!darkBackgroundTexture) darkBackgroundTexture = makeBackgroundTexture("#2b3037", "#171b20");
    return darkBackgroundTexture;
  }
  if (!lightBackgroundTexture) lightBackgroundTexture = makeBackgroundTexture("#b9b9b9", "#8f8f8f");
  return lightBackgroundTexture;
}

interface ModelPreviewProps {
  scene: THREE.Object3D | null;
  wireframe: boolean;
  showAxes?: boolean;
  showAxisLabels?: boolean;
  view?: PreviewView;
  fitSignal?: number;
  resetSignal?: number;
  darkMode: boolean;
  label?: string;
  emptyText?: string;
  syncId?: string;
  syncEnabled?: boolean;
  syncState?: CameraSyncState | null;
  onSyncChange?: (state: CameraSyncState) => void;
  colourCorrection?: TextureColourCorrection | null;
}


function isIdentityCorrection(correction: TextureColourCorrection | null | undefined): boolean {
  if (!correction) return true;
  return (
    correction.brightness === 0 &&
    correction.contrast === 0 &&
    correction.saturation === 0 &&
    correction.temperature === 0 &&
    correction.hue === 0 &&
    correction.tint === 0 &&
    Math.abs(correction.gamma - 1) < 1e-9
  );
}

function imageSize(image: unknown): { width: number; height: number } | null {
  if (!image || typeof image !== "object") return null;
  const record = image as Record<string, unknown>;
  const width = Number(record.width ?? record.naturalWidth ?? record.videoWidth);
  const height = Number(record.height ?? record.naturalHeight ?? record.videoHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

function cloneCorrectedTexture(texture: THREE.Texture, correction: TextureColourCorrection): THREE.Texture {
  const size = imageSize(texture.image);
  if (!size) return texture.clone();
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return texture.clone();
  try {
    ctx.drawImage(texture.image as CanvasImageSource, 0, 0, size.width, size.height);
    const imageData = ctx.getImageData(0, 0, size.width, size.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const corrected = applyTextureColourCorrection(
        { r: data[i], g: data[i + 1], b: data[i + 2] },
        correction,
      );
      data[i] = corrected.r;
      data[i + 1] = corrected.g;
      data[i + 2] = corrected.b;
    }
    ctx.putImageData(imageData, 0, 0);
  } catch {
    return texture.clone();
  }
  const corrected = new THREE.CanvasTexture(canvas);
  corrected.name = `${texture.name || "texture"} · colour corrected`;
  corrected.wrapS = texture.wrapS;
  corrected.wrapT = texture.wrapT;
  corrected.magFilter = texture.magFilter;
  corrected.minFilter = texture.minFilter;
  corrected.anisotropy = texture.anisotropy;
  corrected.generateMipmaps = texture.generateMipmaps;
  corrected.flipY = texture.flipY;
  corrected.colorSpace = texture.colorSpace;
  corrected.offset.copy(texture.offset);
  corrected.repeat.copy(texture.repeat);
  corrected.center.copy(texture.center);
  corrected.rotation = texture.rotation;
  corrected.needsUpdate = true;
  return corrected;
}

type PreviewMaterialWithColour = THREE.Material & {
  color?: THREE.Color;
  map?: THREE.Texture | null;
  emissive?: THREE.Color;
  emissiveMap?: THREE.Texture | null;
};

function cloneCorrectedMaterial(material: THREE.Material, correction: TextureColourCorrection): THREE.Material {
  const clone = material.clone() as PreviewMaterialWithColour;
  if (clone.color) {
    const corrected = applyTextureColourCorrection(
      {
        r: Math.round(clone.color.r * 255),
        g: Math.round(clone.color.g * 255),
        b: Math.round(clone.color.b * 255),
      },
      correction,
    );
    clone.color.setRGB(corrected.r / 255, corrected.g / 255, corrected.b / 255);
  }
  if (clone.map) clone.map = cloneCorrectedTexture(clone.map, correction);
  if (clone.emissive) {
    const corrected = applyTextureColourCorrection(
      {
        r: Math.round(clone.emissive.r * 255),
        g: Math.round(clone.emissive.g * 255),
        b: Math.round(clone.emissive.b * 255),
      },
      correction,
    );
    clone.emissive.setRGB(corrected.r / 255, corrected.g / 255, corrected.b / 255);
  }
  if (clone.emissiveMap) clone.emissiveMap = cloneCorrectedTexture(clone.emissiveMap, correction);
  clone.needsUpdate = true;
  return clone;
}

function applyPreviewColourCorrection(root: THREE.Object3D, correction: TextureColourCorrection | null | undefined): void {
  if (isIdentityCorrection(correction) || !correction) return;
  const resolvedCorrection = correction;
  const materialCache = new Map<THREE.Material, THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const assignMaterial = (material: THREE.Material): THREE.Material => {
      const cached = materialCache.get(material);
      if (cached) return cached;
      const corrected = cloneCorrectedMaterial(material, resolvedCorrection);
      materialCache.set(material, corrected);
      return corrected;
    };
    if (Array.isArray(object.material)) object.material = object.material.map(assignMaterial);
    else if (object.material) object.material = assignMaterial(object.material);
  });
}

function buildCameraSyncState(
  syncId: string,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): CameraSyncState {
  return {
    sourceId: syncId,
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [controls.target.x, controls.target.y, controls.target.z],
    zoom: camera.zoom,
  };
}

// Texture Baking renders imported GLB/glTF/OBJ scenes in Three.js/glTF
// coordinates. These assets are Y-up in the preview. VertexColor previews use
// the baked/OBJ printer convention, where Z is up. The view mapping must
// therefore stay workflow-specific; otherwise GLB models appear to lie down.
function viewDirection(view: PreviewView): THREE.Vector3 {
  switch (view) {
    case "front":
      return new THREE.Vector3(0, 0, 1);
    case "back":
      return new THREE.Vector3(0, 0, -1);
    case "left":
      return new THREE.Vector3(-1, 0, 0);
    case "top":
      return new THREE.Vector3(0, 1, 0);
    case "bottom":
      return new THREE.Vector3(0, -1, 0);
    case "right":
    default:
      return new THREE.Vector3(1, 0, 0);
  }
}

function viewUp(view: PreviewView): THREE.Vector3 {
  if (view === "top") return new THREE.Vector3(0, 0, -1);
  if (view === "bottom") return new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3(0, 1, 0);
}

function meshBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const geometry = object.geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const geometryBox = geometry.boundingBox;
    if (!geometryBox || geometryBox.isEmpty()) return;
    box.union(geometryBox.clone().applyMatrix4(object.matrixWorld));
  });
  return box;
}

function distanceForBoxView(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
  center: THREE.Vector3,
  direction: THREE.Vector3,
  up: THREE.Vector3,
): number {
  const viewDirection = direction.clone();
  if (viewDirection.lengthSq() < 1e-12) viewDirection.set(1, 0, 0);
  viewDirection.normalize();

  const viewUp = up.clone();
  if (viewUp.lengthSq() < 1e-12) viewUp.set(0, 1, 0);
  viewUp.normalize();

  let right = new THREE.Vector3().crossVectors(viewUp, viewDirection);
  if (right.lengthSq() < 1e-12) {
    const fallbackUp = Math.abs(viewDirection.z) > 0.95
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
    right = new THREE.Vector3().crossVectors(fallbackUp, viewDirection);
  }
  right.normalize();
  const actualUp = new THREE.Vector3()
    .crossVectors(viewDirection, right)
    .normalize();

  const min = box.min;
  const max = box.max;
  const corners = [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];

  let halfWidth = 0;
  let halfHeight = 0;
  for (const corner of corners) {
    const offset = corner.sub(center);
    halfWidth = Math.max(halfWidth, Math.abs(offset.dot(right)));
    halfHeight = Math.max(halfHeight, Math.abs(offset.dot(actualUp)));
  }

  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const aspect = Math.max(camera.aspect || 1, 0.001);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const distanceForHeight =
    Math.max(halfHeight, 0.001) / Math.tan(verticalFov / 2);
  const distanceForWidth =
    Math.max(halfWidth, 0.001) / Math.tan(horizontalFov / 2);
  return Math.max(distanceForHeight, distanceForWidth, 0.001) * 1.28;
}

function fitCameraToBox(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  box: THREE.Box3,
  direction: THREE.Vector3,
  up: THREE.Vector3,
): void {
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const cameraDirection = direction.clone();
  if (cameraDirection.lengthSq() < 1e-12) cameraDirection.set(1, 0, 0);
  cameraDirection.normalize();

  const cameraUp = up.clone();
  if (cameraUp.lengthSq() < 1e-12) cameraUp.set(0, 1, 0);
  cameraUp.normalize();

  const cameraDistance = distanceForBoxView(
    camera,
    box,
    center,
    cameraDirection,
    cameraUp,
  );
  const diagonal = Math.max(size.length(), 0.001);

  camera.up.copy(cameraUp);
  camera.position.copy(center).addScaledVector(cameraDirection, cameraDistance);
  camera.near = Math.max(cameraDistance / 1000, diagonal / 10000, 0.001);
  camera.far = Math.max(cameraDistance + diagonal * 10, cameraDistance * 1000);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function fitCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
  view: PreviewView,
): void {
  const box = meshBounds(object);
  if (box.isEmpty()) {
    camera.position.set(0, 0, 5);
    controls.target.set(0, 0, 0);
    controls.update();
    return;
  }
  fitCameraToBox(camera, controls, box, viewDirection(view), viewUp(view));
}

function fitCameraToCurrentView(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
  fallbackView: PreviewView,
): void {
  const box = meshBounds(object);
  if (box.isEmpty()) return;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  direction.negate();
  if (direction.lengthSq() < 1e-12) direction.copy(viewDirection(fallbackView));

  fitCameraToBox(camera, controls, box, direction, camera.up);
}

function removeWireframeOverlay(root: THREE.Object3D): void {
  const overlays: THREE.LineSegments[] = [];
  root.traverse((object) => {
    if (object.name === "Wireframe overlay")
      overlays.push(object as THREE.LineSegments);
  });
  overlays.forEach((overlay) => {
    overlay.parent?.remove(overlay);
    overlay.geometry.dispose();
    const material = overlay.material as THREE.Material | THREE.Material[];
    if (Array.isArray(material)) material.forEach((mat) => mat.dispose());
    else material.dispose();
  });
}

function addWireframeOverlay(root: THREE.Object3D, darkMode: boolean): void {
  removeWireframeOverlay(root);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: darkMode ? 0xe8eef5 : 0x14202b,
    transparent: true,
    opacity: 0.42,
    depthTest: true,
  });

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const wireGeometry = new THREE.WireframeGeometry(object.geometry);
    const wire = new THREE.LineSegments(wireGeometry, lineMaterial.clone());
    wire.name = "Wireframe overlay";
    object.add(wire);
  });
  lineMaterial.dispose();
}

function makeAxisGuideGeometry(box: THREE.Box3): AxisGuideGeometry {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const margin = Math.max(maxDim * 0.1, 0.05);
  const minHalfExtent = maxDim * 0.12;
  const halfX = Math.max(size.x / 2 + margin, minHalfExtent);
  const halfY = Math.max(size.y / 2 + margin, minHalfExtent);
  const halfZ = Math.max(size.z / 2 + margin, minHalfExtent);

  return {
    positions: new Float32Array([
      center.x - halfX, center.y, center.z, center.x + halfX, center.y, center.z,
      center.x, center.y - halfY, center.z, center.x, center.y + halfY, center.z,
      center.x, center.y, center.z - halfZ, center.x, center.y, center.z + halfZ,
    ]),
    colors: new Float32Array([
      1, 0.12, 0.02, 1, 0.12, 0.02,
      0.2, 1, 0.05, 0.2, 1, 0.05,
      0, 0.72, 1, 0, 0.72, 1,
    ]),
    labels: {
      negX: new THREE.Vector3(center.x - halfX, center.y, center.z),
      posX: new THREE.Vector3(center.x + halfX, center.y, center.z),
      negY: new THREE.Vector3(center.x, center.y - halfY, center.z),
      posY: new THREE.Vector3(center.x, center.y + halfY, center.z),
      negZ: new THREE.Vector3(center.x, center.y, center.z - halfZ),
      posZ: new THREE.Vector3(center.x, center.y, center.z + halfZ),
    },
  };
}

function makeAxesHelper(root: THREE.Object3D): THREE.LineSegments | null {
  const box = meshBounds(root);
  if (box.isEmpty()) return null;
  const guide = makeAxisGuideGeometry(box);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(guide.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(guide.colors, 3));
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    // Use normal depth testing so axes behind the model are hidden. The axes
    // extend beyond the bounding box, keeping the outer parts visible without
    // drawing guide lines across the model surface.
    depthTest: true,
    depthWrite: false,
    transparent: false,
    opacity: 1,
  });
  material.toneMapped = false;

  const axes = new THREE.LineSegments(geometry, material);
  axes.name = "Bounding-box axes";
  axes.renderOrder = 0;
  return axes;
}

function disposeAxesHelper(axes: THREE.LineSegments): void {
  axes.geometry.dispose();
  const material = axes.material as THREE.Material | THREE.Material[];
  if (Array.isArray(material)) material.forEach((mat) => mat.dispose());
  else material.dispose();
}

function hideAxisLabelElements(labelRefs: AxisLabelRefs): void {
  for (const definition of AXIS_LABEL_DEFINITIONS) {
    const element = labelRefs[definition.key];
    if (!element) continue;
    element.style.display = "none";
  }
}

function updateAxisLabelElements(
  root: THREE.Object3D | null,
  camera: THREE.PerspectiveCamera | null,
  container: HTMLDivElement | null,
  labelRefs: AxisLabelRefs,
  visible: boolean,
): void {
  if (!visible || !root || !camera || !container) {
    hideAxisLabelElements(labelRefs);
    return;
  }

  const box = meshBounds(root);
  if (box.isEmpty()) {
    hideAxisLabelElements(labelRefs);
    return;
  }

  const guide = makeAxisGuideGeometry(box);
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) {
    hideAxisLabelElements(labelRefs);
    return;
  }

  for (const definition of AXIS_LABEL_DEFINITIONS) {
    const element = labelRefs[definition.key];
    if (!element) continue;
    const projected = guide.labels[definition.key].clone().project(camera);
    if (projected.z < -1 || projected.z > 1) {
      element.style.display = "none";
      continue;
    }
    element.style.display = "block";
    element.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
    element.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
  }
}

export default function ModelPreview({
  scene,
  wireframe,
  showAxes = false,
  showAxisLabels = false,
  view = "right",
  fitSignal = 0,
  resetSignal = 0,
  darkMode,
  label = "Preview",
  emptyText = "Load a GLB model to start diagnostics",
  syncId = "preview",
  syncEnabled = false,
  syncState = null,
  onSyncChange,
  colourCorrection = null,
}: ModelPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const syncEnabledRef = useRef(syncEnabled);
  const onSyncChangeRef = useRef(onSyncChange);
  const applyingExternalSyncRef = useRef(false);
  const pendingEmitRef = useRef<number | null>(null);
  const wireframeTimerRef = useRef<number | null>(null);
  const threeSceneRef = useRef<THREE.Scene | null>(null);
  const modelRootRef = useRef<THREE.Object3D | null>(null);
  const axesRef = useRef<THREE.LineSegments | null>(null);
  const axisLabelRefs = useRef<AxisLabelRefs>({});
  const showAxisLabelsRef = useRef(showAxisLabels);
  const lastCameraStateRef = useRef<CameraSyncState | null>(null);
  const lastSceneRef = useRef<THREE.Object3D | null>(null);
  const lastViewRef = useRef<PreviewView>(view);
  const lastFitSignalRef = useRef(fitSignal);
  const lastResetSignalRef = useRef(resetSignal);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    syncEnabledRef.current = syncEnabled;
  }, [syncEnabled]);

  useEffect(() => {
    showAxisLabelsRef.current = showAxisLabels;
    if (!showAxisLabels) hideAxisLabelElements(axisLabelRefs.current);
  }, [showAxisLabels]);

  useEffect(() => {
    onSyncChangeRef.current = onSyncChange;
  }, [onSyncChange]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (
      !camera ||
      !controls ||
      !syncEnabled ||
      !syncState ||
      syncState.sourceId === syncId
    )
      return;

    applyingExternalSyncRef.current = true;
    camera.position.set(...syncState.position);
    camera.zoom = syncState.zoom;
    camera.updateProjectionMatrix();
    controls.target.set(...syncState.target);
    controls.update();

    window.requestAnimationFrame(() => {
      applyingExternalSyncRef.current = false;
    });
  }, [syncEnabled, syncId, syncState]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(darkMode ? PREVIEW_DARK_BACKGROUND : PREVIEW_LIGHT_BACKGROUND, 1);
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.background = previewBackground(darkMode);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    cameraRef.current = camera;
    controlsRef.current = controls;

    const emitSyncState = () => {
      if (
        !syncEnabledRef.current ||
        !onSyncChangeRef.current ||
        applyingExternalSyncRef.current
      )
        return;
      if (pendingEmitRef.current !== null) return;
      pendingEmitRef.current = window.requestAnimationFrame(() => {
        pendingEmitRef.current = null;
        const currentCamera = cameraRef.current;
        const currentControls = controlsRef.current;
        if (
          !currentCamera ||
          !currentControls ||
          !syncEnabledRef.current ||
          !onSyncChangeRef.current ||
          applyingExternalSyncRef.current
        )
          return;
        onSyncChangeRef.current(
          buildCameraSyncState(syncId, currentCamera, currentControls),
        );
      });
    };

    controls.addEventListener("change", emitSyncState);

    const updateCameraAspectFromContainer = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    updateCameraAspectFromContainer();

    const ambient = new THREE.AmbientLight(0xffffff, 1.4);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(4, 5, 7);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-5, 2, -4);
    threeScene.add(ambient, key, fill);

    threeSceneRef.current = threeScene;
    let modelRoot: THREE.Object3D | null = null;
    if (scene) {
      modelRoot = scene.clone(true);
      modelRoot.name = "Preview root";
      applyPreviewColourCorrection(modelRoot, colourCorrection);
      modelRootRef.current = modelRoot;
      threeScene.add(modelRoot);
      const canPreserveCamera = Boolean(
        lastCameraStateRef.current &&
        lastSceneRef.current === scene &&
        lastViewRef.current === view,
      );
      if (canPreserveCamera && lastCameraStateRef.current) {
        camera.position.set(...lastCameraStateRef.current.position);
        camera.zoom = lastCameraStateRef.current.zoom;
        camera.updateProjectionMatrix();
        controls.target.set(...lastCameraStateRef.current.target);
        controls.update();
      } else {
        fitCamera(camera, controls, modelRoot, view);
      }
      lastSceneRef.current = scene;
      lastViewRef.current = view;
      lastFitSignalRef.current = fitSignal;
      lastResetSignalRef.current = resetSignal;
      emitSyncState();
    } else {
      camera.position.set(2.5, 1.8, 3.5);
      controls.target.set(0, 0, 0);
      controls.update();
    }

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      updateCameraAspectFromContainer();
    };

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      updateAxisLabelElements(
        modelRootRef.current,
        camera,
        container,
        axisLabelRefs.current,
        showAxisLabelsRef.current,
      );
      renderer.render(threeScene, camera);
    };

    resize();
    animate();

    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      if (pendingEmitRef.current !== null) {
        cancelAnimationFrame(pendingEmitRef.current);
        pendingEmitRef.current = null;
      }
      observer.disconnect();
      controls.removeEventListener("change", emitSyncState);
      lastCameraStateRef.current = buildCameraSyncState(
        syncId,
        camera,
        controls,
      );
      controls.dispose();
      cameraRef.current = null;
      controlsRef.current = null;
      if (wireframeTimerRef.current !== null) {
        window.clearTimeout(wireframeTimerRef.current);
        wireframeTimerRef.current = null;
      }
      if (axesRef.current) {
        threeScene.remove(axesRef.current);
        disposeAxesHelper(axesRef.current);
        axesRef.current = null;
      }
      if (modelRootRef.current) removeWireframeOverlay(modelRootRef.current);
      modelRootRef.current = null;
      threeSceneRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [scene, view, darkMode, syncId, colourCorrection]);

  useEffect(() => {
    if (fitSignal === lastFitSignalRef.current) return;
    lastFitSignalRef.current = fitSignal;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const root = modelRootRef.current;
    if (!camera || !controls || !root) return;
    fitCameraToCurrentView(camera, controls, root, view);
  }, [fitSignal, view]);

  useEffect(() => {
    if (resetSignal === lastResetSignalRef.current) return;
    lastResetSignalRef.current = resetSignal;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const root = modelRootRef.current;
    if (!camera || !controls || !root) return;
    fitCamera(camera, controls, root, view);
  }, [resetSignal, view]);

  useEffect(() => {
    const root = modelRootRef.current;
    if (!root) return undefined;
    if (wireframeTimerRef.current !== null) {
      window.clearTimeout(wireframeTimerRef.current);
      wireframeTimerRef.current = null;
    }
    setBusy(true);
    wireframeTimerRef.current = window.setTimeout(() => {
      wireframeTimerRef.current = null;
      if (!modelRootRef.current) {
        setBusy(false);
        return;
      }
      removeWireframeOverlay(modelRootRef.current);
      if (wireframe) addWireframeOverlay(modelRootRef.current, darkMode);
      setBusy(false);
    }, 0);

    return () => {
      if (wireframeTimerRef.current !== null) {
        window.clearTimeout(wireframeTimerRef.current);
        wireframeTimerRef.current = null;
      }
    };
  }, [wireframe, darkMode, scene, view]);

  useEffect(() => {
    const root = modelRootRef.current;
    const threeScene = threeSceneRef.current;
    if (!threeScene) return;

    if (axesRef.current) {
      threeScene.remove(axesRef.current);
      disposeAxesHelper(axesRef.current);
      axesRef.current = null;
    }

    if ((showAxes || showAxisLabels) && root) {
      const axes = makeAxesHelper(root);
      if (axes) {
        axesRef.current = axes;
        threeScene.add(axes);
      }
    }
    if (!showAxisLabels) hideAxisLabelElements(axisLabelRefs.current);
  }, [showAxes, showAxisLabels, scene, view, darkMode]);

  return (
    <div
      className={`three-preview-wrap ${darkMode ? "preview-bg-dark" : "preview-bg-light"}`}
    >
      <div ref={containerRef} className="three-preview" />
      {AXIS_LABEL_DEFINITIONS.map((definition) => (
        <span
          key={definition.key}
          ref={(element) => {
            axisLabelRefs.current[definition.key] = element;
          }}
          className={`axis-label ${definition.className}`}
        >
          {definition.label}
        </span>
      ))}
      {!scene && <div className="preview-empty">{emptyText}</div>}
      {busy && <div className="preview-busy">Building preview...</div>}
      {scene && (
        <div className="preview-badge">
          {label}
          {wireframe ? " + wireframe" : ""}
          {showAxes ? " · axes" : ""}
          {syncEnabled ? " · sync" : ""}
        </div>
      )}
    </div>
  );
}
