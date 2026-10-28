import { useEffect, useRef, type CSSProperties } from "react";

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
  const changeRef = useRef(onChange);
  const percent = max > 0 ? Math.min(100, (value * 100) / max) : 0;
  const style = variant === "marker" ? { left: `${percent}%` } : { width: `${percent}%` };

  useEffect(() => {
    changeRef.current = onChange;
  });

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const commit = () => changeRef.current?.(input.valueAsNumber);
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
          max={Math.max(0, max)}
          step={1}
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={valueText}
          onInput={(event) => onInput?.(event.currentTarget.valueAsNumber)}
          // The real commit is handled by the native `change` listener above;
          // React only needs an onChange to treat the range as controlled.
          onChange={() => {}}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      ) : null}
    </div>
  );
}
