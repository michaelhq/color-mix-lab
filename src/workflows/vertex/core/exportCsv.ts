import type { PaletteEntry } from './types';
import { rgbToHex } from './colour';

export function paletteToCsv(palette: PaletteEntry[]): string {
  return ['index,hex,triangle_count', ...palette.map(p => `${p.index},${rgbToHex(p.rgb)},${p.count}`)].join('\n') + '\n';
}

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
