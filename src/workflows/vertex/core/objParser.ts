import type { MeshModel, RGB, Tri, Vec3 } from './types';
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

class ObjParseState {
  vertices: Vec3[] = [];
  vertexColours: Array<RGB | null> = [];
  triangles: Tri[] = [];
  triangleColors: RGB[] = [];
  objectFaceCounts: Record<string, number> = {};
  colourKeys = new Set<number>();
  currentObject = 'default';
  coloredVertexCount = 0;

  processLine(raw: string): void {
    if (!raw || raw.charCodeAt(0) === 35) return; // #
    const line = raw.trim();
    if (!line) return;
    const head = line.slice(0, 2);

    if ((head === 'o ' || head === 'g ') && line.length > 2) {
      this.currentObject = line.slice(2).trim() || 'unnamed';
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
        const rgb: RGB = cols.length === 3
          ? [
              clamp255((cols[0][0] + cols[1][0] + cols[2][0]) / 3),
              clamp255((cols[0][1] + cols[1][1] + cols[2][1]) / 3),
              clamp255((cols[0][2] + cols[1][2] + cols[2][2]) / 3),
            ]
          : [180, 180, 180];
        this.triangles.push(tri);
        this.triangleColors.push(rgb);
        this.colourKeys.add(colourKey(rgb));
        this.objectFaceCounts[this.currentObject] = (this.objectFaceCounts[this.currentObject] || 0) + 1;
      }
    }
  }

  toModel(name: string): MeshModel {
    if (this.vertices.length === 0 || this.triangles.length === 0) {
      throw new Error('No usable vertices/triangles were found. The OBJ must contain triangulatable faces.');
    }
    return {
      name,
      vertices: this.vertices,
      triangles: this.triangles,
      triangleColors: this.triangleColors,
      // Do not retain the per-source-vertex colour table after parsing.
      // It is only needed while deriving face colours, and keeping it on the
      // model causes a significant additional heap peak in Chromium browsers.
      stats: {
        vertexCount: this.vertices.length,
        triangleCount: this.triangles.length,
        coloredVertexCount: this.coloredVertexCount,
        uniqueFaceColors: this.colourKeys.size,
        objectFaceCounts: this.objectFaceCounts,
      },
    };
  }
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
