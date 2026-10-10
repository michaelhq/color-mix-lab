import { useEffect, useRef } from "react";

interface EditableNumberInputProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  title?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function clamp(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === "number") next = Math.max(min, next);
  if (typeof max === "number") next = Math.min(max, next);
  return next;
}

export function EditableNumberInput({
  value,
  min,
  max,
  step,
  className,
  title,
  disabled = false,
  onChange,
}: EditableNumberInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input || document.activeElement === input) return;
    const next = String(value);
    if (input.value !== next) input.value = next;
  }, [value]);

  const commitValidValue = (rawValue: string): void => {
    if (rawValue.trim() === "") return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    onChange(clamp(parsed, min, max));
  };

  return (
    <input
      ref={inputRef}
      className={className}
      type="number"
      min={min}
      max={max}
      step={step}
      defaultValue={value}
      title={title}
      disabled={disabled}
      onChange={(event) => commitValidValue(event.currentTarget.value)}
      onBlur={(event) => {
        const rawValue = event.currentTarget.value;
        const parsed = rawValue.trim() === "" ? Number.NaN : Number(rawValue);
        const next = Number.isFinite(parsed)
          ? clamp(parsed, min, max)
          : value;
        onChange(next);
        event.currentTarget.value = String(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = String(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
