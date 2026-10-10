import * as THREE from "three";

const PART_ID_KEY = "colorMixPartId";
const PART_ROOT_KEY = "colorMixPartRoot";
const PART_SOURCE_KEY = "colorMixPartSource";
const PART_BASE_VISIBILITY_KEY = "colorMixBaseVisible";
const PART_NAME_KEY = "colorMixPartName";

export type SceneModelPartSource = "obj-section" | "gltf-node" | "mesh";

export interface SceneModelPart {
  id: string;
  name: string;
  meshCount: number;
  triangleCount: number;
  materialCount: number;
  meshesWithUv: number;
  source: SceneModelPartSource;
}

export interface SceneModelPartMetadata {
  id: string;
  name: string;
}

function meshTriangleCount(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  const positions = geometry?.getAttribute("position");
  if (!positions) return 0;
  return geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor(positions.count / 3);
}

function meshMaterials(mesh: THREE.Mesh): THREE.Material[] {
  if (!mesh.material) return [];
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function descendantMeshes(root: THREE.Object3D, stopAtMarkedRoots = false): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const visit = (node: THREE.Object3D, isRoot: boolean) => {
    if (!isRoot && stopAtMarkedRoots && node.userData?.[PART_ROOT_KEY]) return;
    if (node instanceof THREE.Mesh) meshes.push(node);
    for (const child of node.children) visit(child, false);
  };
  visit(root, true);
  return meshes;
}

function hasMeshDescendant(root: THREE.Object3D): boolean {
  if (root instanceof THREE.Mesh) return true;
  return root.children.some(hasMeshDescendant);
}

function fallbackPartRoots(scene: THREE.Object3D): THREE.Object3D[] {
  const directMeshBearingChildren = scene.children.filter(hasMeshDescendant);
  if (directMeshBearingChildren.length > 1) return directMeshBearingChildren;

  if (directMeshBearingChildren.length === 1) {
    const onlyChild = directMeshBearingChildren[0];
    const grandchildren = onlyChild.children.filter(hasMeshDescendant);
    if (grandchildren.length > 1) return grandchildren;
    return [onlyChild];
  }

  if (scene instanceof THREE.Mesh) return [scene];
  return [];
}

function uniquePartName(
  rawName: string,
  index: number,
  usedNames: Map<string, number>,
): string {
  const base = rawName.trim() || `Part ${index + 1}`;
  const count = usedNames.get(base) ?? 0;
  usedNames.set(base, count + 1);
  return count === 0 ? base : `${base} (${count + 1})`;
}

function partSource(root: THREE.Object3D): SceneModelPartSource {
  const source = root.userData?.[PART_SOURCE_KEY];
  if (source === "obj-section" || source === "gltf-node") return source;
  return "mesh";
}

/**
 * Marks one Object3D as a logical model-part root. Descendant meshes are later
 * associated with this part by discoverSceneModelParts().
 */
export function markSceneModelPartRoot(
  root: THREE.Object3D,
  source: Exclude<SceneModelPartSource, "mesh">,
): void {
  root.userData = {
    ...root.userData,
    [PART_ROOT_KEY]: true,
    [PART_SOURCE_KEY]: source,
  };
}

/**
 * Discovers logical model parts while preserving the scene hierarchy.
 * Explicitly marked OBJ sections / glTF mesh nodes take precedence. If no
 * importer metadata is available, mesh-bearing root children are used.
 */
export function discoverSceneModelParts(scene: THREE.Object3D): SceneModelPart[] {
  const markedRoots: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object !== scene && object.userData?.[PART_ROOT_KEY]) markedRoots.push(object);
  });

  const roots = markedRoots.length > 0 ? markedRoots : fallbackPartRoots(scene);
  const usedNames = new Map<string, number>();
  const parts: SceneModelPart[] = [];

  roots.forEach((root, index) => {
    const id = `part-${index + 1}`;
    const name = uniquePartName(root.name, index, usedNames);
    const meshes = descendantMeshes(root, markedRoots.length > 0);
    if (meshes.length === 0) return;

    const materialIds = new Set<string>();
    let triangleCount = 0;
    let meshesWithUv = 0;

    meshes.forEach((mesh) => {
      mesh.userData = {
        ...mesh.userData,
        [PART_ID_KEY]: id,
        [PART_NAME_KEY]: name,
        [PART_BASE_VISIBILITY_KEY]:
          typeof mesh.userData?.[PART_BASE_VISIBILITY_KEY] === "boolean"
            ? mesh.userData[PART_BASE_VISIBILITY_KEY]
            : mesh.visible,
      };
      triangleCount += meshTriangleCount(mesh);
      if (mesh.geometry?.getAttribute("uv")) meshesWithUv += 1;
      meshMaterials(mesh).forEach((material) => materialIds.add(material.uuid));
    });

    parts.push({
      id,
      name,
      meshCount: meshes.length,
      triangleCount,
      materialCount: materialIds.size,
      meshesWithUv,
      source: partSource(root),
    });
  });

  if (parts.length === 0) {
    const meshes = descendantMeshes(scene);
    if (meshes.length > 0) {
      const id = "part-1";
      const name = scene.name.trim() || "Model";
      const materialIds = new Set<string>();
      let triangleCount = 0;
      let meshesWithUv = 0;
      meshes.forEach((mesh) => {
        mesh.userData = {
        ...mesh.userData,
        [PART_ID_KEY]: id,
        [PART_NAME_KEY]: name,
        [PART_BASE_VISIBILITY_KEY]:
          typeof mesh.userData?.[PART_BASE_VISIBILITY_KEY] === "boolean"
            ? mesh.userData[PART_BASE_VISIBILITY_KEY]
            : mesh.visible,
      };
        triangleCount += meshTriangleCount(mesh);
        if (mesh.geometry?.getAttribute("uv")) meshesWithUv += 1;
        meshMaterials(mesh).forEach((material) => materialIds.add(material.uuid));
      });
      parts.push({
        id,
        name,
        meshCount: meshes.length,
        triangleCount,
        materialCount: materialIds.size,
        meshesWithUv,
        source: "mesh",
      });
    }
  }

  return parts;
}

export function getSceneModelPartMetadata(
  object: THREE.Object3D,
): SceneModelPartMetadata | null {
  const id = object.userData?.[PART_ID_KEY];
  if (typeof id !== "string" || !id) return null;
  const rawName = object.userData?.[PART_NAME_KEY];
  return {
    id,
    name:
      typeof rawName === "string" && rawName.trim()
        ? rawName.trim()
        : object.name.trim() || id,
  };
}

export function setSceneModelPartVisibility(
  scene: THREE.Object3D,
  enabledPartIds: ReadonlySet<string>,
): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const partId = object.userData?.[PART_ID_KEY];
    const baseVisible = object.userData?.[PART_BASE_VISIBILITY_KEY] !== false;
    object.visible =
      baseVisible && (typeof partId === "string" ? enabledPartIds.has(partId) : true);
  });
}
