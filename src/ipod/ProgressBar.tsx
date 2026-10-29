import { useEffect, useEffectEvent, useRef, type CSSProperties } from "react";

type ProgressBarProps = {
  value: number;
  max: number;
  testId: string;
  variant?: "fill" | "marker";
  label?: string;
  valueText?: string;
  disabled?: boolean;
  onInput?: (value: number) => void;
  onChange?: (value: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
};

function finiteLimit(max: number) {
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

export function ProgressBar({
  value,
  max,
  testId,
  variant = "fill",
  label,
  valueText,
  disabled = false,
  onInput,
  onChange,
  onFocus,
  onBlur,
}: ProgressBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const limit = finiteLimit(max);
  const safeValue = Number.isFinite(value) ? value : 0;
  const percent = limit > 0 ? Math.min(100, (safeValue * 100) / limit) : 0;
  const style = variant === "marker" ? { left: `${percent}%` } : { width: `${percent}%` };

  const commitChange = useEffectEvent((next: number) => {
    if (!Number.isFinite(next)) return;
    onChange?.(next);
  });

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const commit = () => commitChange(input.valueAsNumber);
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, [label]);

  return (
    <div className="progress-bar" data-testid={`${testId}-bar`}>
      {variant === "marker" ? (
        <div
          className="progress-marker"
          data-testid={`${testId}-marker`}
          style={style as CSSProperties}
        />
      ) : (
        <div className="progress-fill" data-testid={`${testId}-fill`} style={style} />
      )}
      {label ? (
        <input
          ref={inputRef}
          className="range-input"
          type="range"
          tabIndex={0}
          min={0}
          max={limit}
          step={1}
          value={safeValue}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={valueText}
          onInput={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (!Number.isFinite(next)) return;
            onInput?.(next);
          }}
          // React needs onChange so the range stays controlled; commit listens to the native event.
          onChange={() => {}}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      ) : null}
    </div>
  );
}
