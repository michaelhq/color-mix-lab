import * as THREE from 'three';

export interface MeshDiagnostics {
  fileName: string;
  meshCount: number;
  skinnedMeshCount: number;
  materialCount: number;
  textureCount: number;
  textureSourceMaxSize: number;
  textureSourceSizeSummary: string;
  baseColorTextureMaxSize: number;
  baseColorTextureSizeSummary: string;
  normalMapCount: number;
  bumpMapCount: number;
  displacementMapCount: number;
  roughnessMapCount: number;
  metalnessMapCount: number;
  aoMapCount: number;
  emissiveMapCount: number;
  alphaMapCount: number;
  transparentMaterialCount: number;
  alphaBlendMaterialCount: number;
  alphaMaskMaterialCount: number;
  transmissionMaterialCount: number;
  transmissionMapCount: number;
  clearcoatMaterialCount: number;
  clearcoatMapCount: number;
  uv2MeshCount: number;
  uv3MeshCount: number;
  vertexCount: number;
  uniquePositionCount: number;
  duplicatePositionCount: number;
  triangleCount: number;
  degenerateTriangles: number;
  thinTriangles: number;
  duplicateFaces: number;
  totalEdges: number;
  openEdges: number;
  nonManifoldEdges: number;
  meshesWithUV: number;
  meshesWithoutUV: number;
  trianglesWithoutUV: number;
  trianglesWithUVOutside01: number;
  meshesWithVertexColors: number;
  meshesWithBaseColorTexture: number;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
    diagonal: number;
  } | null;
  warnings: string[];
}

type MaterialWithMap = THREE.Material & {
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  bumpMap?: THREE.Texture | null;
  displacementMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  transmission?: number;
  transmissionMap?: THREE.Texture | null;
  clearcoat?: number;
  clearcoatMap?: THREE.Texture | null;
  clearcoatNormalMap?: THREE.Texture | null;
  clearcoatRoughnessMap?: THREE.Texture | null;
  alphaTest?: number;
  color?: THREE.Color;
};

const POSITION_EPSILON = 1e-5;
const THIN_TRIANGLE_ASPECT_RATIO = 100;

function quantize(n: number, epsilon = POSITION_EPSILON): string {
  if (!Number.isFinite(n)) return 'nan';
  return String(Math.round(n / epsilon));
}

function positionKey(v: THREE.Vector3): string {
  return `${quantize(v.x)},${quantize(v.y)},${quantize(v.z)}`;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function faceKey(a: string, b: string, c: string): string {
  return [a, b, c].sort().join('|');
}

function toMaterialArray(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function textureImageSize(texture: THREE.Texture | null | undefined): { width: number; height: number } | null {
  if (!texture) return null;
  const image = texture.image as
    | { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }
    | undefined;
  const width = Math.round(image?.width ?? image?.naturalWidth ?? 0);
  const height = Math.round(image?.height ?? image?.naturalHeight ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function addTextureSize(
  texture: THREE.Texture | null | undefined,
  target: Map<string, { width: number; height: number; count: number }>,
): void {
  const size = textureImageSize(texture);
  if (!size) return;
  const key = `${size.width}×${size.height}`;
  const entry = target.get(key);
  if (entry) entry.count += 1;
  else target.set(key, { ...size, count: 1 });
}

function textureKLabel(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '–';
  if (size >= 8192) return '8K';
  if (size >= 4096) return '4K';
  if (size >= 2048) return '2K';
  if (size >= 1024) return '1K';
  return `${size} px`;
}

function textureSizeSummary(sizes: Map<string, { width: number; height: number; count: number }>): string {
  if (sizes.size === 0) return '';
  const entries = [...sizes.values()].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height));
  const parts = entries.slice(0, 4).map((entry) => {
    const maxSide = Math.max(entry.width, entry.height);
    const countLabel = entry.count > 1 ? ` · ${entry.count}×` : '';
    return `${textureKLabel(maxSide)} (${entry.width}×${entry.height}${countLabel})`;
  });
  if (entries.length > parts.length) parts.push(`+${entries.length - parts.length} weitere`);
  return parts.join(', ');
}

function maxTextureSide(sizes: Map<string, { width: number; height: number; count: number }>): number {
  let max = 0;
  sizes.forEach((entry) => {
    max = Math.max(max, entry.width, entry.height);
  });
  return max;
}

function getTriangleIndex(index: THREE.BufferAttribute | null, triangleStart: number, offset: number): number {
  return index ? index.getX(triangleStart + offset) : triangleStart + offset;
}

function getWorldPosition(
  positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vertexIndex: number,
  matrixWorld: THREE.Matrix4,
  target: THREE.Vector3,
): THREE.Vector3 {
  target.set(positions.getX(vertexIndex), positions.getY(vertexIndex), positions.getZ(vertexIndex));
  target.applyMatrix4(matrixWorld);
  return target;
}

function triangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  return new THREE.Vector3().crossVectors(ab, ac).length() * 0.5;
}

function triangleAspectRatio(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, area: number): number {
  if (area <= 0) return Number.POSITIVE_INFINITY;
  const ab = a.distanceTo(b);
  const bc = b.distanceTo(c);
  const ca = c.distanceTo(a);
  const longest = Math.max(ab, bc, ca);
  const altitude = (2 * area) / longest;
  if (altitude <= 0) return Number.POSITIVE_INFINITY;
  return longest / altitude;
}

function hasUvOutside01(
  uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  a: number,
  b: number,
  c: number,
): boolean {
  const indices = [a, b, c];
  return indices.some((i) => {
    const u = uv.getX(i);
    const v = uv.getY(i);
    return !Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1;
  });
}

function buildWarnings(diagnostics: Omit<MeshDiagnostics, 'warnings'>): string[] {
  const warnings: string[] = [];
  if (diagnostics.meshCount === 0) warnings.push('No mesh geometry found.');
  if (diagnostics.triangleCount === 0) warnings.push('No triangles found.');
  if (diagnostics.openEdges > 0) warnings.push('Open edges found. The model is probably not watertight; repair larger holes in Blender before baking.');
  if (diagnostics.nonManifoldEdges > 0) warnings.push('Non-manifold edges found. Clean them up in Blender or a mesh-repair tool before export.');
  if (diagnostics.degenerateTriangles > 0) warnings.push('Degenerate triangles with very small or zero area found.');
  if (diagnostics.duplicateFaces > 0) warnings.push('Duplicate faces found.');
  if (diagnostics.trianglesWithoutUV > 0) warnings.push('Some triangles have no UV coordinates and cannot be baked from the texture.');
  if (diagnostics.textureCount === 0) warnings.push('No base-colour texture found. Baking will use material colours or vertex colours as fallback.');
  if (diagnostics.normalMapCount + diagnostics.bumpMapCount + diagnostics.displacementMapCount > 0) warnings.push('Normal/bump/height maps found. They are not baked as print colours. Bump/height maps can be used experimentally for relief geometry.');
  if (diagnostics.roughnessMapCount + diagnostics.metalnessMapCount > 0) warnings.push('Roughness/metalness maps found. They are not colour information; at most they can be used as detail indicators for subdivision.');
  if (diagnostics.emissiveMapCount > 0) warnings.push('Emissive textures found. They can optionally be included as a visible colour source during baking.');
  if (diagnostics.alphaBlendMaterialCount + diagnostics.alphaMaskMaterialCount + diagnostics.alphaMapCount > 0) warnings.push('Alpha/transparency materials found. Visible colours can depend on overlays; base-colour-only baking can differ.');
  if (diagnostics.transmissionMaterialCount + diagnostics.clearcoatMaterialCount > 0) warnings.push('Transmission/clearcoat materials found. These are renderer material effects and are not transferred as print colours.');
  if (diagnostics.uv2MeshCount + diagnostics.uv3MeshCount > 0) warnings.push('Additional UV sets found. Base colour/emissive currently still use UV0 primarily.');
  if (diagnostics.trianglesWithUVOutside01 > 0) warnings.push('UV coordinates outside 0–1 found. The model may use wrapping or tiling.');
  if (diagnostics.triangleCount > 800_000) warnings.push('Very high triangle count. Browser memory usage may increase significantly.');
  return warnings;
}

export function analyzeScene(scene: THREE.Object3D, fileName: string): MeshDiagnostics {
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(scene);
  const boxSize = new THREE.Vector3();
  const boxMin = new THREE.Vector3();
  const boxMax = new THREE.Vector3();
  let boundingBox: MeshDiagnostics['boundingBox'] = null;

  if (!box.isEmpty()) {
    box.getSize(boxSize);
    box.getCenter(new THREE.Vector3());
    boxMin.copy(box.min);
    boxMax.copy(box.max);
    boundingBox = {
      min: [boxMin.x, boxMin.y, boxMin.z],
      max: [boxMax.x, boxMax.y, boxMax.z],
      size: [boxSize.x, boxSize.y, boxSize.z],
      diagonal: boxSize.length(),
    };
  }

  const diagonal = boundingBox?.diagonal ?? 1;
  const degenerateAreaThreshold = Math.max(1e-14, diagonal * diagonal * 1e-14);

  const uniquePositions = new Set<string>();
  const edges = new Map<string, number>();
  const faces = new Map<string, number>();
  const materials = new Set<string>();
  const textures = new Set<string>();
  const textureSizes = new Map<string, { width: number; height: number; count: number }>();
  const baseColorTextureSizes = new Map<string, { width: number; height: number; count: number }>();
  const normalMaps = new Set<string>();
  const bumpMaps = new Set<string>();
  const displacementMaps = new Set<string>();
  const roughnessMaps = new Set<string>();
  const metalnessMaps = new Set<string>();
  const aoMaps = new Set<string>();
  const emissiveMaps = new Set<string>();
  const alphaMaps = new Set<string>();
  const transmissionMaps = new Set<string>();
  const clearcoatMaps = new Set<string>();

  let meshCount = 0;
  let skinnedMeshCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let degenerateTriangles = 0;
  let thinTriangles = 0;
  let meshesWithUV = 0;
  let meshesWithoutUV = 0;
  let trianglesWithoutUV = 0;
  let trianglesWithUVOutside01 = 0;
  let meshesWithVertexColors = 0;
  let meshesWithBaseColorTexture = 0;
  let transparentMaterialCount = 0;
  let alphaBlendMaterialCount = 0;
  let alphaMaskMaterialCount = 0;
  let transmissionMaterialCount = 0;
  let clearcoatMaterialCount = 0;
  let uv2MeshCount = 0;
  let uv3MeshCount = 0;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    meshCount += 1;
    if (object instanceof THREE.SkinnedMesh) skinnedMeshCount += 1;

    const geometry = object.geometry;
    const positions = geometry.getAttribute('position');
    if (!positions) return;

    const uv = geometry.getAttribute('uv');
    const uv2 = geometry.getAttribute('uv2');
    const uv3 = geometry.getAttribute('uv3');
    const vertexColors = geometry.getAttribute('color');
    const index = geometry.index;
    const triangleTotal = index ? Math.floor(index.count / 3) : Math.floor(positions.count / 3);

    vertexCount += positions.count;
    triangleCount += triangleTotal;

    if (uv) meshesWithUV += 1;
    else {
      meshesWithoutUV += 1;
      trianglesWithoutUV += triangleTotal;
    }

    if (uv2) uv2MeshCount += 1;
    if (uv3) uv3MeshCount += 1;

    if (vertexColors) meshesWithVertexColors += 1;

    const objectMaterials = toMaterialArray(object.material);
    let meshHasTexture = false;
    objectMaterials.forEach((material) => {
      materials.add(material.uuid);
      const typedMaterial = material as MaterialWithMap;
      const map = typedMaterial.map;
      if (map) {
        meshHasTexture = true;
        textures.add(map.uuid);
        addTextureSize(map, textureSizes);
        addTextureSize(map, baseColorTextureSizes);
      }
      if (typedMaterial.normalMap) { normalMaps.add(typedMaterial.normalMap.uuid); addTextureSize(typedMaterial.normalMap, textureSizes); }
      if (typedMaterial.bumpMap) { bumpMaps.add(typedMaterial.bumpMap.uuid); addTextureSize(typedMaterial.bumpMap, textureSizes); }
      if (typedMaterial.displacementMap) { displacementMaps.add(typedMaterial.displacementMap.uuid); addTextureSize(typedMaterial.displacementMap, textureSizes); }
      if (typedMaterial.roughnessMap) { roughnessMaps.add(typedMaterial.roughnessMap.uuid); addTextureSize(typedMaterial.roughnessMap, textureSizes); }
      if (typedMaterial.metalnessMap) { metalnessMaps.add(typedMaterial.metalnessMap.uuid); addTextureSize(typedMaterial.metalnessMap, textureSizes); }
      if (typedMaterial.aoMap) { aoMaps.add(typedMaterial.aoMap.uuid); addTextureSize(typedMaterial.aoMap, textureSizes); }
      if (typedMaterial.emissiveMap) { emissiveMaps.add(typedMaterial.emissiveMap.uuid); addTextureSize(typedMaterial.emissiveMap, textureSizes); }
      if (typedMaterial.alphaMap) { alphaMaps.add(typedMaterial.alphaMap.uuid); addTextureSize(typedMaterial.alphaMap, textureSizes); }
      if (typedMaterial.transparent || (typedMaterial.opacity ?? 1) < 0.999) transparentMaterialCount += 1;
      if (material.alphaTest && material.alphaTest > 0) alphaMaskMaterialCount += 1;
      if ((material as THREE.Material).transparent || (typedMaterial.opacity ?? 1) < 0.999) alphaBlendMaterialCount += 1;
      if ((typedMaterial.transmission ?? 0) > 0 || typedMaterial.transmissionMap) {
        transmissionMaterialCount += 1;
        if (typedMaterial.transmissionMap) { transmissionMaps.add(typedMaterial.transmissionMap.uuid); addTextureSize(typedMaterial.transmissionMap, textureSizes); }
      }
      if ((typedMaterial.clearcoat ?? 0) > 0 || typedMaterial.clearcoatMap || typedMaterial.clearcoatNormalMap || typedMaterial.clearcoatRoughnessMap) {
        clearcoatMaterialCount += 1;
        if (typedMaterial.clearcoatMap) { clearcoatMaps.add(typedMaterial.clearcoatMap.uuid); addTextureSize(typedMaterial.clearcoatMap, textureSizes); }
        if (typedMaterial.clearcoatNormalMap) { clearcoatMaps.add(typedMaterial.clearcoatNormalMap.uuid); addTextureSize(typedMaterial.clearcoatNormalMap, textureSizes); }
        if (typedMaterial.clearcoatRoughnessMap) { clearcoatMaps.add(typedMaterial.clearcoatRoughnessMap.uuid); addTextureSize(typedMaterial.clearcoatRoughnessMap, textureSizes); }
      }
    });
    if (meshHasTexture) meshesWithBaseColorTexture += 1;

    for (let t = 0; t < triangleTotal; t += 1) {
      const triangleStart = t * 3;
      const ia = getTriangleIndex(index, triangleStart, 0);
      const ib = getTriangleIndex(index, triangleStart, 1);
      const ic = getTriangleIndex(index, triangleStart, 2);

      getWorldPosition(positions, ia, object.matrixWorld, a);
      getWorldPosition(positions, ib, object.matrixWorld, b);
      getWorldPosition(positions, ic, object.matrixWorld, c);

      const ka = positionKey(a);
      const kb = positionKey(b);
      const kc = positionKey(c);
      uniquePositions.add(ka);
      uniquePositions.add(kb);
      uniquePositions.add(kc);

      const area = triangleArea(a, b, c);
      if (area <= degenerateAreaThreshold || ka === kb || kb === kc || ka === kc) {
        degenerateTriangles += 1;
      } else if (triangleAspectRatio(a, b, c, area) >= THIN_TRIANGLE_ASPECT_RATIO) {
        thinTriangles += 1;
      }

      const e1 = edgeKey(ka, kb);
      const e2 = edgeKey(kb, kc);
      const e3 = edgeKey(kc, ka);
      edges.set(e1, (edges.get(e1) ?? 0) + 1);
      edges.set(e2, (edges.get(e2) ?? 0) + 1);
      edges.set(e3, (edges.get(e3) ?? 0) + 1);

      const fk = faceKey(ka, kb, kc);
      faces.set(fk, (faces.get(fk) ?? 0) + 1);

      if (uv && hasUvOutside01(uv, ia, ib, ic)) {
        trianglesWithUVOutside01 += 1;
      }
    }
  });

  let openEdges = 0;
  let nonManifoldEdges = 0;
  edges.forEach((count) => {
    if (count === 1) openEdges += 1;
    if (count > 2) nonManifoldEdges += 1;
  });

  let duplicateFaces = 0;
  faces.forEach((count) => {
    if (count > 1) duplicateFaces += count - 1;
  });

  const withoutWarnings = {
    fileName,
    meshCount,
    skinnedMeshCount,
    materialCount: materials.size,
    textureCount: textures.size,
    textureSourceMaxSize: maxTextureSide(textureSizes),
    textureSourceSizeSummary: textureSizeSummary(textureSizes),
    baseColorTextureMaxSize: maxTextureSide(baseColorTextureSizes),
    baseColorTextureSizeSummary: textureSizeSummary(baseColorTextureSizes),
    normalMapCount: normalMaps.size,
    bumpMapCount: bumpMaps.size,
    displacementMapCount: displacementMaps.size,
    roughnessMapCount: roughnessMaps.size,
    metalnessMapCount: metalnessMaps.size,
    aoMapCount: aoMaps.size,
    emissiveMapCount: emissiveMaps.size,
    alphaMapCount: alphaMaps.size,
    transparentMaterialCount,
    alphaBlendMaterialCount,
    alphaMaskMaterialCount,
    transmissionMaterialCount,
    transmissionMapCount: transmissionMaps.size,
    clearcoatMaterialCount,
    clearcoatMapCount: clearcoatMaps.size,
    uv2MeshCount,
    uv3MeshCount,
    vertexCount,
    uniquePositionCount: uniquePositions.size,
    duplicatePositionCount: Math.max(0, vertexCount - uniquePositions.size),
    triangleCount,
    degenerateTriangles,
    thinTriangles,
    duplicateFaces,
    totalEdges: edges.size,
    openEdges,
    nonManifoldEdges,
    meshesWithUV,
    meshesWithoutUV,
    trianglesWithoutUV,
    trianglesWithUVOutside01,
    meshesWithVertexColors,
    meshesWithBaseColorTexture,
    boundingBox,
  };

  return {
    ...withoutWarnings,
    warnings: buildWarnings(withoutWarnings),
  };
}
