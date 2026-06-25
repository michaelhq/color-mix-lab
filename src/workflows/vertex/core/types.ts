export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];
export type Vec3 = [number, number, number];
export type Tri = [number, number, number];
export type AccentProtectionMode = 'off' | 'balanced' | 'strong';
export type VirtualMixPriorityMode = 'accurate' | 'preserve-hue' | 'avoid-muddy';

export interface MeshModel {
  name: string;
  vertices: Vec3[];
  triangles: Tri[];
  triangleColors: RGB[];
  /** Optional per-source-vertex colours. Normally omitted after parsing to reduce Chromium memory pressure. */
  vertexColors?: Array<RGB | null>;
  stats: {
    vertexCount: number;
    triangleCount: number;
    coloredVertexCount: number;
    uniqueFaceColors: number;
    objectFaceCounts: Record<string, number>;
  };
}

export interface ColourAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  hue: number;
  tint: number;
  gamma: number;
}

export interface Filament {
  name: string;
  type: string;
  rgb: RGB;
  rgba?: RGBA;
  effectiveRgb: RGB;
  sourceLine: string;
}

export interface PhysicalSlot {
  slot: number;
  filament: Filament;
  role: string;
}

export interface PaletteEntry {
  index: number;
  rgb: RGB;
  count: number;
}
