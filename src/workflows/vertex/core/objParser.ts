import type { MeshModel, MeshPart, RGB, Tri, Vec3 } from './types';
import { clamp255 } from './colour';

export interface ObjParseProgress {
  phase: 'reading' | 'parsing';
  loadedBytes?: number;
  totalBytes?: number;
  vertexCount?: number;
  triangleCount?: number;
}

function parseRgbValues(vals: string[]): RGB | null {
  if (vals.length < 3) return null;
  const r = Number(vals[0]);
  const g = Number(vals[1]);
  const b = Number(vals[2]);
  if ([r, g, b].some(n => Number.isNaN(n))) return null;
  if (Math.max(r, g, b) <= 1.0) return [clamp255(r * 255), clamp255(g * 255), clamp255(b * 255)];
  return [clamp255(r), clamp255(g), clamp255(b)];
}

function resolveIndex(token: string, vertexCount: number): number {
  const vi = Number.parseInt(token.split('/')[0], 10);
  if (!Number.isFinite(vi) || vi === 0) throw new Error(`Invalid face index: ${token}`);
  return vi < 0 ? vertexCount + vi : vi - 1;
}

function colourKey(rgb: RGB): number {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

function cleanSectionName(value: string, fallback: string): string {
  const cleaned = value.trim();
  return cleaned || fallback;
}

class ObjParseState {
  vertices: Vec3[] = [];
  vertexColours: Array<RGB | null> = [];
  triangles: Tri[] = [];
  triangleColors: RGB[] = [];
  triangleObjectNames: string[] = [];
  triangleGroupNames: string[] = [];
  colourKeys = new Set<number>();
  currentObject = 'default';
  currentGroup = 'default';
  coloredVertexCount = 0;
  pendingFaceColor: RGB | null = null;

  processLine(raw: string): void {
    if (!raw) return;
    const line = raw.trim();
    if (!line) return;

    if (line.startsWith('#')) {
      const prefix = '# VC2CM face_color ';
      if (line.startsWith(prefix)) {
        this.pendingFaceColor = parseRgbValues(line.slice(prefix.length).trim().split(/\s+/));
      }
      return;
    }

    const head = line.slice(0, 2);

    if (head === 'o ' && line.length > 2) {
      this.currentObject = cleanSectionName(line.slice(2), 'unnamed object');
      return;
    }

    if (head === 'g ' && line.length > 2) {
      this.currentGroup = cleanSectionName(line.slice(2), 'unnamed group');
      return;
    }

    if (head === 'v ') {
      const parts = line.split(/\s+/);
      if (parts.length < 4) return;
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (![x, y, z].every(Number.isFinite)) return;
      this.vertices.push([x, y, z]);
      const rgb = parseRgbValues(parts.slice(4, 7));
      if (rgb) this.coloredVertexCount += 1;
      this.vertexColours.push(rgb);
      return;
    }

    if (head === 'f ') {
      const explicitFaceColor = this.pendingFaceColor;
      this.pendingFaceColor = null;
      const parts = line.split(/\s+/);
      if (parts.length < 4) return;
      let indices: number[];
      try {
        indices = parts.slice(1).map(t => resolveIndex(t, this.vertices.length));
      } catch {
        return;
      }
      for (let i = 1; i < indices.length - 1; i++) {
        const tri: Tri = [indices[0], indices[i], indices[i + 1]];
        if (tri.some(idx => idx < 0 || idx >= this.vertices.length)) continue;
        const cols = tri.map(idx => this.vertexColours[idx]).filter((c): c is RGB => c !== null);
        const rgb: RGB = explicitFaceColor ?? (cols.length === 3
          ? [
              clamp255((cols[0][0] + cols[1][0] + cols[2][0]) / 3),
              clamp255((cols[0][1] + cols[1][1] + cols[2][1]) / 3),
              clamp255((cols[0][2] + cols[1][2] + cols[2][2]) / 3),
            ]
          : [180, 180, 180]);
        this.triangles.push(tri);
        this.triangleColors.push(rgb);
        this.triangleObjectNames.push(this.currentObject);
        this.triangleGroupNames.push(this.currentGroup);
        this.colourKeys.add(colourKey(rgb));
      }
    }
  }

  private buildParts(): { parts: MeshPart[]; trianglePartIndices: Uint32Array; objectFaceCounts: Record<string, number> } {
    const explicitObjects = new Set(
      this.triangleObjectNames.filter(name => name !== 'default'),
    );
    const explicitGroups = new Set(
      this.triangleGroupNames.filter(name => name !== 'default'),
    );

    const source: MeshPart['source'] = explicitObjects.size >= 2
      ? 'object'
      : explicitGroups.size >= 2
        ? 'group'
        : 'single';

    const names = source === 'object'
      ? this.triangleObjectNames
      : source === 'group'
        ? this.triangleGroupNames
        : this.triangleObjectNames.map((objectName, index) => {
            if (objectName !== 'default') return objectName;
            const groupName = this.triangleGroupNames[index];
            return groupName !== 'default' ? groupName : 'Model';
          });

    const partIndexByName = new Map<string, number>();
    const parts: MeshPart[] = [];
    const trianglePartIndices = new Uint32Array(this.triangles.length);
    const objectFaceCounts: Record<string, number> = {};

    names.forEach((rawName, triangleIndex) => {
      const name = rawName === 'default' ? 'Ungrouped' : rawName;
      let partIndex = partIndexByName.get(name);
      if (partIndex === undefined) {
        partIndex = parts.length;
        partIndexByName.set(name, partIndex);
        parts.push({
          id: `part-${partIndex + 1}`,
          name,
          triangleCount: 0,
          source,
        });
      }
      trianglePartIndices[triangleIndex] = partIndex;
      parts[partIndex].triangleCount += 1;
      objectFaceCounts[name] = (objectFaceCounts[name] || 0) + 1;
    });

    return { parts, trianglePartIndices, objectFaceCounts };
  }

  toModel(name: string): MeshModel {
    if (this.vertices.length === 0 || this.triangles.length === 0) {
      throw new Error('No usable vertices/triangles were found. The OBJ must contain triangulatable faces.');
    }
    const { parts, trianglePartIndices, objectFaceCounts } = this.buildParts();
    return {
      name,
      vertices: this.vertices,
      triangles: this.triangles,
      triangleColors: this.triangleColors,
      parts,
      trianglePartIndices,
      // Do not retain the per-source-vertex colour table after parsing.
      // It is only needed while deriving face colours, and keeping it on the
      // model causes a significant additional heap peak in Chromium browsers.
      stats: {
        vertexCount: this.vertices.length,
        triangleCount: this.triangles.length,
        coloredVertexCount: this.coloredVertexCount,
        uniqueFaceColors: this.colourKeys.size,
        objectFaceCounts,
      },
    };
  }
}

export function filterMeshModelByPartIds(
  model: MeshModel,
  enabledPartIds: ReadonlySet<string>,
): MeshModel {
  if (enabledPartIds.size >= model.parts.length && model.parts.every(part => enabledPartIds.has(part.id))) {
    return model;
  }

  const selectedOldPartIndices = new Set<number>();
  model.parts.forEach((part, index) => {
    if (enabledPartIds.has(part.id)) selectedOldPartIndices.add(index);
  });
  if (selectedOldPartIndices.size === 0) {
    throw new Error('At least one model part must remain selected.');
  }

  const selectedParts: MeshPart[] = [];
  const newPartIndexByOldIndex = new Map<number, number>();
  model.parts.forEach((part, oldIndex) => {
    if (!selectedOldPartIndices.has(oldIndex)) return;
    const newIndex = selectedParts.length;
    newPartIndexByOldIndex.set(oldIndex, newIndex);
    selectedParts.push({ ...part });
  });

  const vertexMap = new Map<number, number>();
  const vertices: Vec3[] = [];
  const triangles: Tri[] = [];
  const triangleColors: RGB[] = [];
  const trianglePartIndices: number[] = [];
  const colourKeys = new Set<number>();
  const objectFaceCounts: Record<string, number> = {};

  const remapVertex = (sourceIndex: number): number => {
    const existing = vertexMap.get(sourceIndex);
    if (existing !== undefined) return existing;
    const next = vertices.length;
    vertexMap.set(sourceIndex, next);
    vertices.push(model.vertices[sourceIndex]);
    return next;
  };

  for (let triangleIndex = 0; triangleIndex < model.triangles.length; triangleIndex += 1) {
    const oldPartIndex = model.trianglePartIndices[triangleIndex] ?? 0;
    const newPartIndex = newPartIndexByOldIndex.get(oldPartIndex);
    if (newPartIndex === undefined) continue;

    const sourceTri = model.triangles[triangleIndex];
    const tri: Tri = [
      remapVertex(sourceTri[0]),
      remapVertex(sourceTri[1]),
      remapVertex(sourceTri[2]),
    ];
    const rgb = model.triangleColors[triangleIndex];
    triangles.push(tri);
    triangleColors.push(rgb);
    trianglePartIndices.push(newPartIndex);
    colourKeys.add(colourKey(rgb));
    const partName = selectedParts[newPartIndex].name;
    objectFaceCounts[partName] = (objectFaceCounts[partName] || 0) + 1;
  }

  const allVerticesColoured = model.stats.coloredVertexCount >= model.stats.vertexCount;
  return {
    ...model,
    vertices,
    triangles,
    triangleColors,
    parts: selectedParts,
    trianglePartIndices: Uint32Array.from(trianglePartIndices),
    stats: {
      vertexCount: vertices.length,
      triangleCount: triangles.length,
      coloredVertexCount: allVerticesColoured
        ? vertices.length
        : Math.min(model.stats.coloredVertexCount, vertices.length),
      uniqueFaceColors: colourKeys.size,
      objectFaceCounts,
    },
  };
}

export function parseObj(text: string, name = 'model.obj'): MeshModel {
  const state = new ObjParseState();
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 10 || ch === 13) {
      if (i > start) state.processLine(text.slice(start, i));
      if (ch === 13 && text.charCodeAt(i + 1) === 10) i += 1;
      start = i + 1;
    }
  }
  if (start < text.length) state.processLine(text.slice(start));
  return state.toModel(name);
}

export async function parseObjFile(
  file: File,
  onProgress?: (progress: ObjParseProgress) => void,
): Promise<MeshModel> {
  const stream = file.stream?.();
  if (!stream) {
    onProgress?.({ phase: 'reading', loadedBytes: 0, totalBytes: file.size });
    const text = await file.text();
    onProgress?.({ phase: 'parsing', loadedBytes: file.size, totalBytes: file.size });
    return parseObj(text, file.name);
  }

  const state = new ObjParseState();
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let loadedBytes = 0;
  let remainder = '';
  let lastProgress = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      loadedBytes += value.byteLength;
      const chunk = decoder.decode(value, { stream: true });
      const text = remainder + chunk;
      let start = 0;
      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (ch === 10 || ch === 13) {
          if (i > start) state.processLine(text.slice(start, i));
          if (ch === 13 && text.charCodeAt(i + 1) === 10) i += 1;
          start = i + 1;
        }
      }
      remainder = text.slice(start);

      if (loadedBytes - lastProgress > 1_000_000 || loadedBytes === file.size) {
        lastProgress = loadedBytes;
        onProgress?.({
          phase: 'parsing',
          loadedBytes,
          totalBytes: file.size,
          vertexCount: state.vertices.length,
          triangleCount: state.triangles.length,
        });
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }
    }

    const tail = decoder.decode();
    const finalLine = remainder + tail;
    if (finalLine.trim()) state.processLine(finalLine);
    onProgress?.({
      phase: 'parsing',
      loadedBytes: file.size,
      totalBytes: file.size,
      vertexCount: state.vertices.length,
      triangleCount: state.triangles.length,
    });
    return state.toModel(file.name);
  } finally {
    reader.releaseLock();
  }
}
