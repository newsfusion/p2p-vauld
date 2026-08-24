interface SwitchToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
  testId?: string;
  trackClassName?: string;
  knobClassName?: string;
  checkedTrackClassName?: string;
  uncheckedTrackClassName?: string;
  checkedKnobClassName?: string;
  uncheckedKnobClassName?: string;
  hideLabel?: boolean;
}

export function SwitchToggle({
  label,
  checked,
  onChange,
  description,
  disabled = false,
  testId,
  trackClassName = "relative h-6 w-11 shrink-0 rounded-full transition-colors",
  knobClassName = "pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-background shadow transition-transform",
  checkedTrackClassName = "bg-primary",
  uncheckedTrackClassName = "bg-muted",
  checkedKnobClassName = "translate-x-5",
  uncheckedKnobClassName = "translate-x-0",
  hideLabel = false,
}: SwitchToggleProps) {
  const button = (
    <button
      type="button"
      role="switch"
      data-testid={testId}
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        trackClassName,
        checked ? checkedTrackClassName : uncheckedTrackClassName,
      ].join(" ")}
    >
      <span
        className={[
          knobClassName,
          checked ? checkedKnobClassName : uncheckedKnobClassName,
        ].join(" ")}
      />
    </button>
  );

  if (hideLabel) return button;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {button}
    </div>
  );
}
