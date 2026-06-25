import JSZip from 'jszip';
import type { RGB } from './types';
import { parseHexColour } from './colour';

export interface Template3mfInfo {
  fileName: string;
  physicalColours: RGB[];
  bedSize?: { x: number; y: number };
  source: 'fullSpectrumJson' | 'slic3rConfig' | 'none';
  configFound: boolean;
  fullSpectrumFound: boolean;
}

function stripLeadingIniComment(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith(';')) return trimmed.slice(1).trim();
  return trimmed;
}

function extractHexColours(value: string): RGB[] {
  const matches = value.match(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/g) || [];
  return matches.flatMap(match => {
    const rgba = parseHexColour(match);
    return rgba ? [[rgba[0], rgba[1], rgba[2]] as RGB] : [];
  });
}

function parseBedShape(value: string): { x: number; y: number } | undefined {
  const points = value.split(',').flatMap(token => {
    const m = token.trim().match(/^(-?\d+(?:\.\d+)?)x(-?\d+(?:\.\d+)?)$/);
    return m ? [{ x: Number(m[1]), y: Number(m[2]) }] : [];
  });
  if (points.length < 2) return undefined;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
}

function parseSlic3rConfig(text: string): { colours: RGB[]; bedSize?: { x: number; y: number } } {
  let colours: RGB[] = [];
  let bedSize: { x: number; y: number } | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripLeadingIniComment(raw);
    if (!line || !line.includes('=')) continue;
    const [keyRaw, ...rest] = line.split('=');
    const key = keyRaw.trim();
    const value = rest.join('=').trim();
    if ((key === 'filament_colour' || key === 'extruder_colour') && colours.length === 0) {
      colours = extractHexColours(value);
    }
    if (key === 'bed_shape') {
      bedSize = parseBedShape(value);
    }
  }
  return { colours, bedSize };
}

function parseFullSpectrumJson(text: string): RGB[] {
  try {
    const data = JSON.parse(text) as { physical_extruders?: Array<{ color?: string; colour?: string }> };
    const physicals = Array.isArray(data.physical_extruders) ? data.physical_extruders : [];
    return physicals.flatMap(p => {
      const colour = p.color || p.colour;
      const rgba = colour ? parseHexColour(colour) : null;
      return rgba ? [[rgba[0], rgba[1], rgba[2]] as RGB] : [];
    });
  } catch {
    return [];
  }
}

export async function readTemplate3mf(file: File): Promise<Template3mfInfo> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const configFile = zip.file('Metadata/Slic3r_PE.config');
  const fsFile = zip.file('Metadata/Prusa_Slicer_full_spectrum.json');
  const configText = configFile ? await configFile.async('text') : '';
  const fsText = fsFile ? await fsFile.async('text') : '';
  const fromFs = fsText ? parseFullSpectrumJson(fsText) : [];
  const fromConfig = configText ? parseSlic3rConfig(configText) : { colours: [] as RGB[], bedSize: undefined };
  const physicalColours = fromFs.length > 0 ? fromFs : fromConfig.colours;
  return {
    fileName: file.name,
    physicalColours,
    bedSize: fromConfig.bedSize,
    source: fromFs.length > 0 ? 'fullSpectrumJson' : fromConfig.colours.length > 0 ? 'slic3rConfig' : 'none',
    configFound: Boolean(configFile),
    fullSpectrumFound: Boolean(fsFile),
  };
}
