export type ModelBottomSide =
  | "current"
  | "posX"
  | "negX"
  | "posY"
  | "negY"
  | "posZ"
  | "negZ";

export type ModelRotationCommand = "left" | "right" | "forward" | "backward";
export type ModelRotationAxis = "x" | "y" | "z";
export type ModelBuildPlateAxis = "negY" | "negZ";

export type OrientationMatrix = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const IDENTITY_ORIENTATION_MATRIX: OrientationMatrix = [
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
];

// Legacy support for project files saved by the previous bottom-side dropdown.
export function isModelBottomSide(value: unknown): value is ModelBottomSide {
  return (
    value === "current" ||
    value === "posX" ||
    value === "negX" ||
    value === "posY" ||
    value === "negY" ||
    value === "posZ" ||
    value === "negZ"
  );
}

export function isOrientationMatrix(value: unknown): value is OrientationMatrix {
  return (
    Array.isArray(value) &&
    value.length === 9 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function axisVector(side: ModelBottomSide): [number, number, number] {
  if (side === "posX") return [1, 0, 0];
  if (side === "negX") return [-1, 0, 0];
  if (side === "posY") return [0, 1, 0];
  if (side === "negY") return [0, -1, 0];
  if (side === "posZ") return [0, 0, 1];
  if (side === "negZ") return [0, 0, -1];
  return [0, 0, 0];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function perpendicularAxis(
  source: [number, number, number],
): [number, number, number] {
  const candidate: [number, number, number] =
    Math.abs(source[0]) < 0.5 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(source, candidate));
}

function rotationMatrixAroundAxis(
  axis: [number, number, number],
  angle: number,
): OrientationMatrix {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * y * x + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * z * x - s * y,
    t * z * y + s * x,
    t * z * z + c,
  ];
}

export function orientationMatrixForBottomSide(
  bottomSide: ModelBottomSide,
  targetBottomSide: Exclude<ModelBottomSide, "current">,
): OrientationMatrix {
  if (bottomSide === "current") return [...IDENTITY_ORIENTATION_MATRIX];
  const source = axisVector(bottomSide);
  const target = axisVector(targetBottomSide);
  const alignment = dot(source, target);
  if (alignment > 0.999999) return [...IDENTITY_ORIENTATION_MATRIX];
  if (alignment < -0.999999)
    return rotationMatrixAroundAxis(perpendicularAxis(source), Math.PI);
  return rotationMatrixAroundAxis(cross(source, target), Math.PI / 2);
}

export function orientationMatrixForQuarterTurn(
  command: ModelRotationCommand,
  buildPlateAxis: ModelBuildPlateAxis,
): OrientationMatrix {
  const verticalAxis: [number, number, number] =
    buildPlateAxis === "negY" ? [0, 1, 0] : [0, 0, 1];
  const frontBackAxis: [number, number, number] =
    buildPlateAxis === "negY" ? [0, 0, 1] : [0, 1, 0];
  const leftRightAxis: [number, number, number] = [1, 0, 0];

  if (command === "left") return rotationMatrixAroundAxis(frontBackAxis, Math.PI / 2);
  if (command === "right") return rotationMatrixAroundAxis(frontBackAxis, -Math.PI / 2);
  if (command === "forward") return rotationMatrixAroundAxis(leftRightAxis, Math.PI / 2);
  if (command === "backward") return rotationMatrixAroundAxis(leftRightAxis, -Math.PI / 2);
  return rotationMatrixAroundAxis(verticalAxis, 0);
}

export function orientationMatrixForAxisAngle(
  axis: ModelRotationAxis,
  angleDegrees: number,
): OrientationMatrix {
  const finiteAngle = Number.isFinite(angleDegrees) ? angleDegrees : 0;
  const vector: [number, number, number] =
    axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
  return rotationMatrixAroundAxis(vector, (finiteAngle * Math.PI) / 180);
}

export function composeOrientationMatrices(
  next: OrientationMatrix,
  current: OrientationMatrix,
): OrientationMatrix {
  return [
    next[0] * current[0] + next[1] * current[3] + next[2] * current[6],
    next[0] * current[1] + next[1] * current[4] + next[2] * current[7],
    next[0] * current[2] + next[1] * current[5] + next[2] * current[8],
    next[3] * current[0] + next[4] * current[3] + next[5] * current[6],
    next[3] * current[1] + next[4] * current[4] + next[5] * current[7],
    next[3] * current[2] + next[4] * current[5] + next[5] * current[8],
    next[6] * current[0] + next[7] * current[3] + next[8] * current[6],
    next[6] * current[1] + next[7] * current[4] + next[8] * current[7],
    next[6] * current[2] + next[7] * current[5] + next[8] * current[8],
  ];
}

export function applyOrientationMatrixToVec3<T extends [number, number, number]>(
  vec: T,
  matrix: OrientationMatrix,
): T {
  const [x, y, z] = vec;
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ] as T;
}

export function isIdentityOrientationMatrix(
  matrix: OrientationMatrix,
): boolean {
  return matrix.every(
    (entry, index) =>
      Math.abs(entry - IDENTITY_ORIENTATION_MATRIX[index]) < 1e-9,
  );
}
