import * as THREE from 'three';

export interface VertexColorObjExportResult {
  obj: string;
  vertexCount: number;
  faceCount: number;
}

function safeObjName(name: string): string {
  return (name || 'baked_mesh').replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.parseFloat(value.toFixed(7)).toString();
}

function linearColorToSrgbFloats(r: number, g: number, b: number): [number, number, number] {
  const color = new THREE.Color(r, g, b);
  color.convertLinearToSRGB();
  return [
    THREE.MathUtils.clamp(color.r, 0, 1),
    THREE.MathUtils.clamp(color.g, 0, 1),
    THREE.MathUtils.clamp(color.b, 0, 1),
  ];
}

function quantizePosition(value: number): string {
  // Tight positional welding for duplicated bake vertices and UV-seam duplicates.
  return Math.round(value * 1_000_000).toString();
}

function positionKey(p: THREE.Vector3): string {
  return `${quantizePosition(p.x)},${quantizePosition(p.y)},${quantizePosition(p.z)}`;
}

interface WeldedVertex {
  position: THREE.Vector3;
  colorR: number;
  colorG: number;
  colorB: number;
  colorCount: number;
}

/**
 * Exports the baked scene as one topology-preserving OBJ with embedded vertex colors.
 *
 * The exported OBJ uses the common extended OBJ convention:
 *   v x y z r g b
 *
 * Vertices are welded by world-space position so adjacent triangles share indices.
 * Colors from all baked triangle corners using the same position are averaged. This
 * keeps the OBJ suitable as the handoff format for VertexColor2ColorMix and avoids
 * the triangle-soup open-edge problem from earlier debug exports.
 *
 * The exported coordinates are intentionally rebased to a local origin after all
 * scene/world transforms have been applied. GLB assets often carry large world
 * translations; if those are written into OBJ, downstream tools can fail to center
 * the model correctly. Re-basing keeps the final object size unchanged, but removes
 * arbitrary world offsets.
 */
export function exportBakedSceneToVertexColorObj(
  scene: THREE.Object3D,
  modelName = 'baked_model',
  exportScale = 1,
): VertexColorObjExportResult {
  scene.updateMatrixWorld(true);

  const fileBase = safeObjName(modelName);
  const safeScale = Number.isFinite(exportScale) && exportScale > 0 ? exportScale : 1;
  const vertices: WeldedVertex[] = [];
  const vertexIndexByKey = new Map<string, number>();
  const faceLines: string[] = [];
  const rawMin = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const rawMax = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  let faceCount = 0;

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute('position');
    if (!position) return;

    const color = geometry.getAttribute('color');
    const index = geometry.index;
    const matrixWorld = object.matrixWorld.clone();
    const meshName = safeObjName(object.name || 'mesh');
    faceLines.push(`g ${meshName}`);

    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
    for (let tri = 0; tri < triangleCount; tri += 1) {
      const exportedIndices: number[] = [];

      for (let corner = 0; corner < 3; corner += 1) {
        const local = index ? index.getX(tri * 3 + corner) : tri * 3 + corner;
        const p = new THREE.Vector3(position.getX(local), position.getY(local), position.getZ(local))
          .applyMatrix4(matrixWorld);

        let cornerRgb: [number, number, number] = [0.8, 0.8, 0.8];
        if (color) {
          cornerRgb = linearColorToSrgbFloats(color.getX(local), color.getY(local), color.getZ(local));
        }

        const key = positionKey(p);
        let exportedIndex = vertexIndexByKey.get(key);
        if (exportedIndex === undefined) {
          exportedIndex = vertices.length + 1;
          vertexIndexByKey.set(key, exportedIndex);
          rawMin.min(p);
          rawMax.max(p);
          vertices.push({
            position: p.clone(),
            colorR: cornerRgb[0],
            colorG: cornerRgb[1],
            colorB: cornerRgb[2],
            colorCount: 1,
          });
        } else {
          const welded = vertices[exportedIndex - 1];
          welded.colorR += cornerRgb[0];
          welded.colorG += cornerRgb[1];
          welded.colorB += cornerRgb[2];
          welded.colorCount += 1;
        }
        exportedIndices.push(exportedIndex);
      }

      faceLines.push(`f ${exportedIndices[0]} ${exportedIndices[1]} ${exportedIndices[2]}`);
      faceCount += 1;
    }
  });

  const hasVertices = vertices.length > 0 && Number.isFinite(rawMin.x) && Number.isFinite(rawMax.x);
  const rawCenter = hasVertices
    ? new THREE.Vector3().addVectors(rawMin, rawMax).multiplyScalar(0.5)
    : new THREE.Vector3();
  const rawSize = hasVertices ? new THREE.Vector3().subVectors(rawMax, rawMin) : new THREE.Vector3();

  const objLines: string[] = [];
  objLines.push('# VC2CM Texture Lab baked vertex-color OBJ');
  objLines.push('# Handoff format for VertexColor2ColorMix. Colors are embedded as: v x y z r g b');
  objLines.push('# Vertices are welded by position; colors at shared vertices are averaged.');
  objLines.push('# Coordinates are rebased to local bounding-box center before scaling.');
  objLines.push(`# Raw world bbox min: ${formatNumber(rawMin.x)} ${formatNumber(rawMin.y)} ${formatNumber(rawMin.z)}`);
  objLines.push(`# Raw world bbox max: ${formatNumber(rawMax.x)} ${formatNumber(rawMax.y)} ${formatNumber(rawMax.z)}`);
  objLines.push(`# Raw world bbox size: ${formatNumber(rawSize.x)} ${formatNumber(rawSize.y)} ${formatNumber(rawSize.z)}`);
  objLines.push(`# Local origin subtracted before export: ${formatNumber(rawCenter.x)} ${formatNumber(rawCenter.y)} ${formatNumber(rawCenter.z)}`);
  objLines.push(`# Export scale applied to vertex coordinates after rebasing: ${formatNumber(safeScale)}x`);
  objLines.push(`o ${fileBase}`);

  for (const vertex of vertices) {
    const count = Math.max(vertex.colorCount, 1);
    const r = THREE.MathUtils.clamp(vertex.colorR / count, 0, 1);
    const g = THREE.MathUtils.clamp(vertex.colorG / count, 0, 1);
    const b = THREE.MathUtils.clamp(vertex.colorB / count, 0, 1);
    const p = vertex.position.clone().sub(rawCenter).multiplyScalar(safeScale);
    objLines.push(
      `v ${formatNumber(p.x)} ${formatNumber(p.y)} ${formatNumber(p.z)} ${formatNumber(r)} ${formatNumber(g)} ${formatNumber(b)}`,
    );
  }

  for (const line of faceLines) objLines.push(line);
  objLines.push('');

  return {
    obj: objLines.join('\n'),
    vertexCount: vertices.length,
    faceCount,
  };
}
