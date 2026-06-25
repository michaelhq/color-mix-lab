import type { MeshModel, RGB } from '../core/types';

interface BuildGeometryRequest {
  requestId: number;
  model: MeshModel;
  colors: RGB[];
}

interface BuildGeometrySuccess {
  requestId: number;
  ok: true;
  positions: Float32Array;
  colours: Float32Array;
  triangleCount: number;
}

interface BuildGeometryFailure {
  requestId: number;
  ok: false;
  error: string;
}

type BuildGeometryResponse = BuildGeometrySuccess | BuildGeometryFailure;

function srgbChannelToLinear(v: number): number {
  const c = Math.max(0, Math.min(1, v / 255));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

self.onmessage = (event: MessageEvent<BuildGeometryRequest>) => {
  const { requestId, model, colors } = event.data;
  try {
    const triCount = model.triangles.length;
    const positions = new Float32Array(triCount * 9);
    const colours = new Float32Array(triCount * 9);

    let p = 0;
    let c = 0;
    for (let i = 0; i < triCount; i++) {
      const tri = model.triangles[i];
      const rgb = colors[i] || model.triangleColors[i] || [180, 180, 180];

      // Three.js materials and the WebGL renderer work in linear colour space.
      // OBJ vertex colours, palette colours and CSS/hex values are sRGB values.
      // Therefore the preview buffer must contain linearised vertex colours.
      // Without this conversion the rendered model appears too bright and washed out.
      const r = srgbChannelToLinear(rgb[0]);
      const g = srgbChannelToLinear(rgb[1]);
      const b = srgbChannelToLinear(rgb[2]);

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

    const response: BuildGeometrySuccess = {
      requestId,
      ok: true,
      positions,
      colours,
      triangleCount: triCount,
    };
    (self as unknown as { postMessage: (message: unknown, transfer?: Transferable[]) => void }).postMessage(response, [positions.buffer, colours.buffer]);
  } catch (err) {
    const response: BuildGeometryFailure = {
      requestId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};

export type { BuildGeometryRequest, BuildGeometryResponse };
