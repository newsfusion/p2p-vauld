import { getPasswordStrength } from "../password-strength.js";

const ACTIVE_SEGMENT_CLASSES = [
  "bg-destructive",
  "bg-orange-500",
  "bg-amber-500",
  "bg-blue-500",
  "bg-emerald-500",
] as const;

export function PasswordStrengthMeter({
  password,
  id,
}: {
  password: string;
  id: string;
}) {
  if (!password) return null;

  const strength = getPasswordStrength(password);

  return (
    <div id={id} className="space-y-1.5" aria-live="polite">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Password strength</span>
        <span className="font-medium text-foreground">{strength.label}</span>
      </div>
      <div className="grid grid-cols-5 gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className={`h-1.5 rounded-full ${
              segment <= strength.score
                ? ACTIVE_SEGMENT_CLASSES[strength.score]
                : "bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
