import * as THREE from "three";

export type PreviewDisplayMode = "shaded" | "flat";
export type PreviewCoordinateMode = "textureYUp" | "printerZUp";

const SHADED_PREVIEW_AMBIENT_INTENSITY = 1.4;
const SHADED_PREVIEW_KEY_INTENSITY = 1.2;
const SHADED_PREVIEW_FILL_INTENSITY = 0.45;
const SHADED_PREVIEW_KEY_POSITION = new THREE.Vector3(4, 5, 7);
const SHADED_PREVIEW_FILL_POSITION = new THREE.Vector3(-5, 2, -4);

function positionForCoordinateMode(
  source: THREE.Vector3,
  coordinateMode: PreviewCoordinateMode,
): THREE.Vector3 {
  if (coordinateMode === "textureYUp") return source.clone();
  // Texture Baking uses Three.js Y-up coordinates. The baked OBJ handoff uses
  // printer Z-up coordinates: (x, y, z) -> (x, -z, y). Apply the same rotation
  // to the light rig so corresponding faces receive the same illumination.
  return new THREE.Vector3(source.x, -source.z, source.y);
}

export function configurePreviewRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
}

export function addSharedPreviewLights(
  scene: THREE.Scene,
  coordinateMode: PreviewCoordinateMode,
): void {
  scene.add(
    new THREE.AmbientLight(0xffffff, SHADED_PREVIEW_AMBIENT_INTENSITY),
  );

  const key = new THREE.DirectionalLight(
    0xffffff,
    SHADED_PREVIEW_KEY_INTENSITY,
  );
  key.position.copy(
    positionForCoordinateMode(SHADED_PREVIEW_KEY_POSITION, coordinateMode),
  );
  scene.add(key);

  const fill = new THREE.DirectionalLight(
    0xffffff,
    SHADED_PREVIEW_FILL_INTENSITY,
  );
  fill.position.copy(
    positionForCoordinateMode(SHADED_PREVIEW_FILL_POSITION, coordinateMode),
  );
  scene.add(fill);
}

export function makeVertexColourPreviewMaterial(
  displayMode: PreviewDisplayMode,
  wireframe: boolean,
): THREE.Material {
  if (displayMode === "flat") {
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      wireframe,
    });
    material.toneMapped = false;
    return material;
  }

  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
    wireframe,
  });
}

type BaseColourMaterial = THREE.Material & {
  color?: THREE.Color;
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  vertexColors?: boolean;
  wireframe?: boolean;
};

export function makeFlatPreviewMaterial(
  sourceMaterial: THREE.Material,
): THREE.MeshBasicMaterial {
  const source = sourceMaterial as BaseColourMaterial;
  const material = new THREE.MeshBasicMaterial({
    color: source.color?.clone() ?? new THREE.Color(0xffffff),
    map: source.map ?? null,
    alphaMap: source.alphaMap ?? null,
    vertexColors: Boolean(source.vertexColors),
    side: source.side,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    depthTest: source.depthTest,
    depthWrite: source.depthWrite,
  });
  material.name = `${sourceMaterial.name || sourceMaterial.type} · flat colour`;
  material.blending = source.blending;
  material.premultipliedAlpha = source.premultipliedAlpha;
  material.dithering = source.dithering;
  material.visible = source.visible;
  material.toneMapped = false;
  return material;
}
