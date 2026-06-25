import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  AccentProtectionMode,
  MeshModel,
  PaletteEntry,
  RGB,
} from "../core/types";
import { nearestPaletteIndex } from "../core/quantize";

type View = "front" | "back" | "left" | "right" | "top" | "bottom";
type PreviewBackground = "light" | "dark";
type PreviewDisplayMode = "shaded" | "flat";
type PreviewMode = "adjusted" | "quantized" | "print";
type WebglLodMode = "off" | "tiny" | "small" | "medium";

const DEFAULT_MAX_WEBGL_PREVIEW_TRIANGLES = 2_000_000;

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

function previewBackground(background: PreviewBackground): THREE.CanvasTexture {
  if (background === "dark") {
    if (!darkBackgroundTexture) darkBackgroundTexture = makeBackgroundTexture("#2b3037", "#171b20");
    return darkBackgroundTexture;
  }
  if (!lightBackgroundTexture) lightBackgroundTexture = makeBackgroundTexture("#b9b9b9", "#8f8f8f");
  return lightBackgroundTexture;
}

export interface ThreePreviewHandle {
  resetView: (view?: View) => void;
  fitToModel: () => void;
}

interface ThreePreviewProps {
  model: MeshModel | null;
  adjustedColors: RGB[];
  previewMode: PreviewMode;
  palette: PaletteEntry[];
  effectivePaletteRgbByIndex: Map<number, RGB>;
  accentProtection?: AccentProtectionMode;
  view: View;
  background: PreviewBackground;
  displayMode: PreviewDisplayMode;
  wireframe: boolean;
  showAxes: boolean;
  lodMode?: WebglLodMode;
  maxPreviewTriangles?: number;
  onBusyChange?: (busy: boolean) => void;
  emptyLabel?: string;
  busyLabel?: string;
}

function srgbChannelToLinear(v: number): number {
  const c = Math.max(0, Math.min(1, v / 255));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function srgbChannelToLinearByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(srgbChannelToLinear(v) * 255)));
}

function triangleArea(model: MeshModel, sourceIndex: number): number {
  const tri = model.triangles[sourceIndex];
  const a = model.vertices[tri[0]];
  const b = model.vertices[tri[1]];
  const c = model.vertices[tri[2]];
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
  return Number.isFinite(area) && area > 0 ? area : 0;
}

function lodDropQuantile(lodMode: WebglLodMode): number {
  if (lodMode === "tiny") return 0.25;
  if (lodMode === "small") return 0.5;
  if (lodMode === "medium") return 0.7;
  return 0;
}

function previewTriangleIndices(
  model: MeshModel,
  lodMode: WebglLodMode,
  maxPreviewTriangles: number,
): number[] {
  const triangleCount = model.triangles.length;
  if (lodMode === "off" || triangleCount <= 0) {
    return Array.from({ length: triangleCount }, (_, index) => index);
  }

  const areas = new Float64Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) areas[i] = triangleArea(model, i);

  const sorted = new Float64Array(areas);
  sorted.sort();
  const dropQuantile = lodDropQuantile(lodMode);
  const thresholdIndex = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(sorted.length * dropQuantile)),
  );
  const threshold = sorted[thresholdIndex];

  let indices: number[] = [];
  for (let i = 0; i < triangleCount; i++) {
    if (areas[i] >= threshold) indices.push(i);
  }

  const limit = Math.max(1, Math.round(maxPreviewTriangles));
  if (indices.length > limit) {
    const step = Math.ceil(indices.length / limit);
    indices = indices.filter((_, index) => index % step === 0);
  }

  return indices.length > 0 ? indices : [0];
}

function previewColourBucketKey(rgb: RGB): number {
  return ((rgb[0] >> 3) << 10) | ((rgb[1] >> 3) << 5) | (rgb[2] >> 3);
}

function nearestPaletteIndexCached(
  rgb: RGB,
  palette: PaletteEntry[],
  cache: Map<number, number>,
  accentProtection: AccentProtectionMode = "balanced",
): number {
  const key = previewColourBucketKey(rgb);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const next = nearestPaletteIndex(rgb, palette, accentProtection);
  cache.set(key, next);
  return next;
}

function previewColourForTriangle(
  sourceIndex: number,
  model: MeshModel,
  adjustedColors: RGB[],
  previewMode: PreviewMode,
  palette: PaletteEntry[],
  effectivePaletteRgbByIndex: Map<number, RGB>,
  nearestCache: Map<number, number>,
  accentProtection: AccentProtectionMode = "balanced",
): RGB {
  const source = adjustedColors[sourceIndex] ||
    model.triangleColors[sourceIndex] || [180, 180, 180];
  if (previewMode === "adjusted" || palette.length === 0) return source;
  const paletteEntry =
    palette[
      nearestPaletteIndexCached(source, palette, nearestCache, accentProtection)
    ];
  if (!paletteEntry) return source;
  if (previewMode === "print") {
    return (
      effectivePaletteRgbByIndex.get(paletteEntry.index) || paletteEntry.rgb
    );
  }
  return paletteEntry.rgb;
}

function buildPreviewGeometryFromModel(
  model: MeshModel,
  adjustedColors: RGB[],
  previewMode: PreviewMode,
  palette: PaletteEntry[],
  effectivePaletteRgbByIndex: Map<number, RGB>,
  lodMode: WebglLodMode,
  maxPreviewTriangles: number,
  accentProtection: AccentProtectionMode = "balanced",
): { geometry: THREE.BufferGeometry; triangleIndices: number[] } {
  const sourceIndices = previewTriangleIndices(
    model,
    lodMode,
    maxPreviewTriangles,
  );
  const nearestCache = new Map<number, number>();
  const positions = new Float32Array(sourceIndices.length * 9);
  const colours = new Uint8Array(sourceIndices.length * 9);
  let p = 0;
  let c = 0;

  for (const sourceIndex of sourceIndices) {
    const tri = model.triangles[sourceIndex];
    const rgb = previewColourForTriangle(
      sourceIndex,
      model,
      adjustedColors,
      previewMode,
      palette,
      effectivePaletteRgbByIndex,
      nearestCache,
      accentProtection,
    );
    const r = srgbChannelToLinearByte(rgb[0]);
    const g = srgbChannelToLinearByte(rgb[1]);
    const b = srgbChannelToLinearByte(rgb[2]);

    for (let j = 0; j < 3; j++) {
      const v = model.vertices[tri[j]];
      positions[p++] = v[0];
      positions[p++] = v[1];
      positions[p++] = v[2];
      colours[c++] = r;
      colours[c++] = g;
      colours[c++] = b;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3, true));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeVertexNormals();
  return { geometry, triangleIndices: sourceIndices };
}

function writePreviewColourAttributeRange(
  geometry: THREE.BufferGeometry,
  model: MeshModel,
  adjustedColors: RGB[],
  previewMode: PreviewMode,
  palette: PaletteEntry[],
  effectivePaletteRgbByIndex: Map<number, RGB>,
  nearestCache: Map<number, number>,
  triangleIndices: number[],
  start: number,
  end: number,
  accentProtection: AccentProtectionMode = "balanced",
): void {
  const attribute = geometry.getAttribute("color") as
    | THREE.BufferAttribute
    | undefined;
  if (!attribute) return;
  const array = attribute.array;
  let offset = start * 9;

  for (let i = start; i < end; i++) {
    const sourceIndex = triangleIndices[i];
    const rgb = previewColourForTriangle(
      sourceIndex,
      model,
      adjustedColors,
      previewMode,
      palette,
      effectivePaletteRgbByIndex,
      nearestCache,
      accentProtection,
    );
    const r = srgbChannelToLinearByte(rgb[0]);
    const g = srgbChannelToLinearByte(rgb[1]);
    const b = srgbChannelToLinearByte(rgb[2]);

    array[offset++] = r;
    array[offset++] = g;
    array[offset++] = b;
    array[offset++] = r;
    array[offset++] = g;
    array[offset++] = b;
    array[offset++] = r;
    array[offset++] = g;
    array[offset++] = b;
  }
}

function makeMaterial(
  displayMode: PreviewDisplayMode,
  wireframe: boolean,
): THREE.Material {
  if (displayMode === "flat") {
    return new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      wireframe,
    });
  }

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    flatShading: false,
    wireframe,
  });
  // The shaded mode is an editor-style preview. Keep the underlying vertex
  // colours unchanged and brighten only the lighted material response so it is
  // closer to the PrusaSlicer editor view.
  material.color.setScalar(1.08);
  return material;
}

function cameraPositionForView(view: View, distance: number): THREE.Vector3 {
  if (view === "front") return new THREE.Vector3(0, -distance, 0);
  if (view === "back") return new THREE.Vector3(0, distance, 0);
  if (view === "left") return new THREE.Vector3(-distance, 0, 0);
  if (view === "right") return new THREE.Vector3(distance, 0, 0);
  if (view === "bottom") return new THREE.Vector3(0, 0, -distance);
  return new THREE.Vector3(0, 0, distance);
}

function cameraUpForView(view: View): THREE.Vector3 {
  if (view === "top") return new THREE.Vector3(0, 1, 0);
  if (view === "bottom") return new THREE.Vector3(0, -1, 0);
  return new THREE.Vector3(0, 0, 1);
}

function modelBox(mesh: THREE.Mesh | null): THREE.Box3 | null {
  if (!mesh) return null;
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return null;
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
  if (viewUp.lengthSq() < 1e-12) viewUp.set(0, 0, 1);
  viewUp.normalize();

  const right = new THREE.Vector3().crossVectors(viewUp, viewDirection);
  if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
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

function modelCenterAndDistance(
  camera: THREE.PerspectiveCamera,
  mesh: THREE.Mesh | null,
  direction?: THREE.Vector3,
  up?: THREE.Vector3,
) {
  const box = modelBox(mesh);
  if (!box) return null;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const viewDirection = direction ?? camera.position.clone().sub(center);
  const viewUp = up ?? camera.up;
  const distance = distanceForBoxView(
    camera,
    box,
    center,
    viewDirection,
    viewUp,
  );
  return { center, distance, size };
}

function makeAxesHelper(mesh: THREE.Mesh | null): THREE.LineSegments | null {
  const box = modelBox(mesh);
  if (!box) return null;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const margin = Math.max(maxDim * 0.1, 0.05);
  const minHalfExtent = maxDim * 0.12;
  const halfX = Math.max(size.x / 2 + margin, minHalfExtent);
  const halfY = Math.max(size.y / 2 + margin, minHalfExtent);
  const halfZ = Math.max(size.z / 2 + margin, minHalfExtent);

  const positions = new Float32Array([
    center.x - halfX, center.y, center.z, center.x + halfX, center.y, center.z,
    center.x, center.y - halfY, center.z, center.x, center.y + halfY, center.z,
    center.x, center.y, center.z - halfZ, center.x, center.y, center.z + halfZ,
  ]);
  const colors = new Float32Array([
    1, 0.12, 0.02, 1, 0.12, 0.02,
    0.2, 1, 0.05, 0.2, 1, 0.05,
    0, 0.72, 1, 0, 0.72, 1,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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

export const ThreePreview = forwardRef<ThreePreviewHandle, ThreePreviewProps>(
  function ThreePreview(
    {
      model,
      adjustedColors,
      previewMode,
      palette,
      effectivePaletteRgbByIndex,
      view,
      background,
      displayMode,
      wireframe,
      showAxes,
      lodMode = "off",
      maxPreviewTriangles = DEFAULT_MAX_WEBGL_PREVIEW_TRIANGLES,
      accentProtection = "balanced",
      onBusyChange,
      emptyLabel = "No model loaded.",
      busyLabel = "Building preview...",
    },
    ref,
  ) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const meshRef = useRef<THREE.Mesh | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const axesRef = useRef<THREE.LineSegments | null>(null);
    const frameRef = useRef<number | null>(null);
    const requestIdRef = useRef(0);
    const geometryRef = useRef<THREE.BufferGeometry | null>(null);
    const previewTriangleIndicesRef = useRef<number[]>([]);
    const latestPreviewDataRef = useRef({
      adjustedColors,
      previewMode,
      palette,
      effectivePaletteRgbByIndex,
      accentProtection,
    });
    const colorUpdateTimerRef = useRef<number | null>(null);
    const materialUpdateTimerRef = useRef<number | null>(null);
    const colorUpdateRequestRef = useRef(0);
    const [trianglesShown, setTrianglesShown] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function setBusyState(value: boolean) {
      setBusy(value);
      onBusyChange?.(value);
    }

    useEffect(() => {
      latestPreviewDataRef.current = {
        adjustedColors,
        previewMode,
        palette,
        effectivePaletteRgbByIndex,
        accentProtection,
      };
    }, [
      adjustedColors,
      previewMode,
      palette,
      effectivePaletteRgbByIndex,
      accentProtection,
    ]);

    function resetView(nextView: View = view) {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const mesh = meshRef.current;
      if (!camera || !controls || !mesh) return;

      const viewDirection = cameraPositionForView(nextView, 1);
      const viewUp = cameraUpForView(nextView);
      const data = modelCenterAndDistance(camera, mesh, viewDirection, viewUp);
      if (!data) return;
      const { center, distance } = data;

      camera.up.copy(cameraUpForView(nextView));
      camera.position
        .copy(center)
        .add(cameraPositionForView(nextView, distance));
      camera.near = Math.max(0.001, distance / 1000);
      camera.far = distance * 1000;
      camera.lookAt(center);
      camera.updateProjectionMatrix();

      controls.target.copy(center);
      controls.update();
    }

    function fitToModel() {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const mesh = meshRef.current;
      if (!camera || !controls || !mesh) return;

      const currentDirection = new THREE.Vector3();
      camera.getWorldDirection(currentDirection);
      currentDirection.negate();
      if (currentDirection.lengthSq() < 1e-9) {
        currentDirection.copy(cameraPositionForView(view, 1));
      }
      currentDirection.normalize();

      const data = modelCenterAndDistance(
        camera,
        mesh,
        currentDirection,
        camera.up,
      );
      if (!data) return;
      const { center, distance } = data;

      camera.position.copy(center).addScaledVector(currentDirection, distance);
      camera.near = Math.max(0.001, distance / 1000);
      camera.far = distance * 1000;
      camera.lookAt(center);
      camera.updateProjectionMatrix();

      controls.target.copy(center);
      controls.update();
    }

    useImperativeHandle(ref, () => ({ resetView, fitToModel }), [view]);

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;

      const scene = new THREE.Scene();
      scene.background = previewBackground(background);
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
      camera.up.set(0, 0, 1);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      mount.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      scene.add(new THREE.AmbientLight(0xffffff, 0.92));
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.66);
      keyLight.position.set(2, -3, 4);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xffffff, 0.26);
      fillLight.position.set(-2, 2, 2);
      scene.add(fillLight);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.screenSpacePanning = true;
      controlsRef.current = controls;

      const resize = () => {
        const width = Math.max(320, mount.clientWidth);
        const height = Math.max(260, mount.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(mount);

      const animate = () => {
        controls.update();
        renderer.render(scene, camera);
        frameRef.current = requestAnimationFrame(animate);
      };
      animate();

      return () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        if (colorUpdateTimerRef.current !== null)
          window.clearTimeout(colorUpdateTimerRef.current);
        if (materialUpdateTimerRef.current !== null)
          window.clearTimeout(materialUpdateTimerRef.current);
        observer.disconnect();
        controls.dispose();
        if (meshRef.current) {
          scene.remove(meshRef.current);
          meshRef.current.geometry.dispose();
          (meshRef.current.material as THREE.Material).dispose();
        }
        if (axesRef.current) {
          scene.remove(axesRef.current);
          disposeAxesHelper(axesRef.current);
        }
        renderer.renderLists.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        scene.clear();
      };
    }, []);

    useEffect(() => {
      const scene = sceneRef.current;
      if (!scene) return;
      scene.background = previewBackground(background);
    }, [background]);

    useEffect(() => {
      if (!model) {
        setTrianglesShown(0);
        setError(null);
        setBusyState(false);
        if (colorUpdateTimerRef.current !== null) {
          window.clearTimeout(colorUpdateTimerRef.current);
          colorUpdateTimerRef.current = null;
        }
        if (meshRef.current && sceneRef.current) {
          sceneRef.current.remove(meshRef.current);
          meshRef.current.geometry.dispose();
          (meshRef.current.material as THREE.Material).dispose();
          meshRef.current = null;
          rendererRef.current?.renderLists.dispose();
        }
        if (geometryRef.current) {
          geometryRef.current.dispose();
          geometryRef.current = null;
        }
        return;
      }

      if (colorUpdateTimerRef.current !== null) {
        window.clearTimeout(colorUpdateTimerRef.current);
        colorUpdateTimerRef.current = null;
      }

      if (meshRef.current && sceneRef.current) {
        sceneRef.current.remove(meshRef.current);
        meshRef.current.geometry.dispose();
        (meshRef.current.material as THREE.Material).dispose();
        meshRef.current = null;
        rendererRef.current?.renderLists.dispose();
      }
      if (geometryRef.current) {
        geometryRef.current.dispose();
        geometryRef.current = null;
      }

      const requestId = ++requestIdRef.current;
      let cancelled = false;
      setBusyState(true);
      setError(null);

      const timer = window.setTimeout(() => {
        if (cancelled || requestId !== requestIdRef.current) return;
        try {
          const latest = latestPreviewDataRef.current;
          const { geometry, triangleIndices } = buildPreviewGeometryFromModel(
            model,
            latest.adjustedColors,
            latest.previewMode,
            latest.palette,
            latest.effectivePaletteRgbByIndex,
            lodMode,
            maxPreviewTriangles,
            latest.accentProtection,
          );
          if (cancelled || requestId !== requestIdRef.current) {
            geometry.dispose();
            return;
          }

          const scene = sceneRef.current;
          if (!scene) {
            geometry.dispose();
            return;
          }

          geometryRef.current = geometry;
          previewTriangleIndicesRef.current = triangleIndices;
          const material = makeMaterial(displayMode, wireframe);
          const mesh = new THREE.Mesh(geometry, material);
          meshRef.current = mesh;
          scene.add(mesh);
          setTrianglesShown(triangleIndices.length);
          setBusyState(false);
          requestAnimationFrame(() => resetView(view));
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setBusyState(false);
        }
      }, 30);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        if (requestId === requestIdRef.current) {
          setBusyState(false);
        }
      };
    }, [model, lodMode, maxPreviewTriangles, accentProtection]);

    useEffect(() => {
      latestPreviewDataRef.current = {
        adjustedColors,
        previewMode,
        palette,
        effectivePaletteRgbByIndex,
        accentProtection,
      };
      const mesh = meshRef.current;
      const geometry = geometryRef.current;
      if (!model || !mesh || !geometry) return;
      const requestId = ++colorUpdateRequestRef.current;
      if (colorUpdateTimerRef.current !== null) {
        window.clearTimeout(colorUpdateTimerRef.current);
        colorUpdateTimerRef.current = null;
      }

      const triangleIndices = previewTriangleIndicesRef.current;
      const attribute = geometry.getAttribute("color") as
        | THREE.BufferAttribute
        | undefined;
      if (!attribute || triangleIndices.length === 0) return;

      let cursor = 0;
      const chunkSize = triangleIndices.length > 750_000 ? 18_000 : 32_000;
      const nearestCache = new Map<number, number>();
      setBusyState(true);

      const runChunk = () => {
        if (requestId !== colorUpdateRequestRef.current) return;
        try {
          const end = Math.min(triangleIndices.length, cursor + chunkSize);
          writePreviewColourAttributeRange(
            geometry,
            model,
            latestPreviewDataRef.current.adjustedColors,
            latestPreviewDataRef.current.previewMode,
            latestPreviewDataRef.current.palette,
            latestPreviewDataRef.current.effectivePaletteRgbByIndex,
            nearestCache,
            triangleIndices,
            cursor,
            end,
            latestPreviewDataRef.current.accentProtection,
          );
          cursor = end;
          if (cursor < triangleIndices.length) {
            colorUpdateTimerRef.current = window.setTimeout(runChunk, 0);
            return;
          }
          attribute.needsUpdate = true;
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          if (
            cursor >= triangleIndices.length ||
            requestId !== colorUpdateRequestRef.current
          ) {
            colorUpdateTimerRef.current = null;
            if (requestId === colorUpdateRequestRef.current)
              setBusyState(false);
          }
        }
      };

      colorUpdateTimerRef.current = window.setTimeout(runChunk, 0);

      return () => {
        if (colorUpdateTimerRef.current !== null) {
          window.clearTimeout(colorUpdateTimerRef.current);
          colorUpdateTimerRef.current = null;
          if (requestId === colorUpdateRequestRef.current) setBusyState(false);
        }
      };
    }, [
      adjustedColors,
      previewMode,
      palette,
      effectivePaletteRgbByIndex,
      model,
    ]);

    useEffect(() => {
      const mesh = meshRef.current;
      if (!mesh) return undefined;
      if (materialUpdateTimerRef.current !== null) {
        window.clearTimeout(materialUpdateTimerRef.current);
        materialUpdateTimerRef.current = null;
      }
      setBusyState(true);
      materialUpdateTimerRef.current = window.setTimeout(() => {
        materialUpdateTimerRef.current = null;
        const currentMesh = meshRef.current;
        if (!currentMesh) {
          setBusyState(false);
          return;
        }
        const oldMaterial = currentMesh.material as THREE.Material;
        currentMesh.material = makeMaterial(displayMode, wireframe);
        oldMaterial.dispose();
        setBusyState(false);
      }, 0);

      return () => {
        if (materialUpdateTimerRef.current !== null) {
          window.clearTimeout(materialUpdateTimerRef.current);
          materialUpdateTimerRef.current = null;
        }
      };
    }, [displayMode, wireframe]);

    useEffect(() => {
      resetView(view);
    }, [view, trianglesShown]);

    useEffect(() => {
      const scene = sceneRef.current;
      const mesh = meshRef.current;
      if (!scene) return;

      if (axesRef.current) {
        scene.remove(axesRef.current);
        disposeAxesHelper(axesRef.current);
        axesRef.current = null;
      }

      if (showAxes && mesh) {
        const axes = makeAxesHelper(mesh);
        if (!axes) return;
        axesRef.current = axes;
        scene.add(axes);
      }
    }, [showAxes, trianglesShown]);

    return (
      <div className={`three-preview-wrap preview-bg-${background}`}>
        <div ref={mountRef} className="three-preview" />
        {!model && <div className="preview-empty">{emptyLabel}</div>}
        {busy && <div className="preview-busy">{busyLabel}</div>}
        {error && <div className="preview-error">{error}</div>}
        {model && (
          <div className="preview-badge">
            {trianglesShown.toLocaleString()} /{" "}
            {model.triangles.length.toLocaleString()} triangles ·{" "}
            {lodMode === "off" ? "full" : `LOD ${lodMode}`}
          </div>
        )}
      </div>
    );
  },
);
