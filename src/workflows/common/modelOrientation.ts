export type ModelBottomSide =
  | "current"
  | "posX"
  | "negX"
  | "posY"
  | "negY"
  | "posZ"
  | "negZ";

export const MODEL_BOTTOM_SIDE_OPTIONS: Array<{
  value: ModelBottomSide;
  label: string;
}> = [
  { value: "current", label: "Current" },
  { value: "posX", label: "+X side down" },
  { value: "negX", label: "-X side down" },
  { value: "posY", label: "+Y side down" },
  { value: "negY", label: "-Y side down" },
  { value: "posZ", label: "+Z side down" },
  { value: "negZ", label: "-Z side down" },
];

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

export function modelBottomSideLabel(value: ModelBottomSide): string {
  return (
    MODEL_BOTTOM_SIDE_OPTIONS.find((option) => option.value === value)?.label ??
    "Current"
  );
}

export function bottomSideRotation(value: ModelBottomSide): {
  x: number;
  y: number;
  z: number;
} {
  if (value === "posX") return { x: 0, y: Math.PI / 2, z: 0 };
  if (value === "negX") return { x: 0, y: -Math.PI / 2, z: 0 };
  if (value === "posY") return { x: -Math.PI / 2, y: 0, z: 0 };
  if (value === "negY") return { x: Math.PI / 2, y: 0, z: 0 };
  if (value === "posZ") return { x: Math.PI, y: 0, z: 0 };
  return { x: 0, y: 0, z: 0 };
}

export function rotateVec3ForBottomSide<T extends [number, number, number]>(
  vec: T,
  value: ModelBottomSide,
): T {
  const [x, y, z] = vec;
  if (value === "posX") return [z, y, -x] as T;
  if (value === "negX") return [-z, y, x] as T;
  if (value === "posY") return [x, z, -y] as T;
  if (value === "negY") return [x, -z, y] as T;
  if (value === "posZ") return [x, -y, -z] as T;
  return [x, y, z] as T;
}
