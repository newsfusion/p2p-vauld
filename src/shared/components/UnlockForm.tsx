import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { sendBackground } from "../messages.js";

export interface UnlockFormClassNames {
  form?: string;
  label?: string;
  inputWrapper?: string;
  input?: string;
  toggleButton?: string;
  toggleIcon?: string;
  error?: string;
  submitButton?: string;
  submitIcon?: string;
}

interface UnlockFormProps {
  onUnlocked: () => void;
  label?: string;
  placeholder?: string;
  classNames?: UnlockFormClassNames;
}

export function UnlockForm({
  onUnlocked,
  label,
  placeholder,
  classNames,
}: UnlockFormProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;

    setError(null);
    setLoading(true);

    try {
      const response = await sendBackground({
        type: "UNLOCK",
        payload: { password },
      });
      if (response.success) {
        setPassword("");
        onUnlocked();
      } else {
        setError(response.error ?? "Incorrect password");
      }
    } catch {
      setError("Failed to communicate with extension");
    } finally {
      setLoading(false);
    }
  }

  const field = (
    <div className={classNames?.inputWrapper ?? "relative"}>
      <input
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={placeholder}
        aria-label={label ? undefined : (placeholder ?? "Password")}
        required
        autoFocus
        autoComplete="current-password"
        className={
          classNames?.input ??
          "h-11 w-full rounded-md border border-border/60 bg-muted/50 px-3 pr-10 focus:border-primary/50"
        }
      />
      <button
        type="button"
        aria-label={showPassword ? "Hide password" : "Show password"}
        className={
          classNames?.toggleButton ??
          "absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
        }
        onClick={() => setShowPassword((v) => !v)}
      >
        {showPassword ? (
          <EyeOff className={classNames?.toggleIcon ?? "h-4 w-4"} />
        ) : (
          <Eye className={classNames?.toggleIcon ?? "h-4 w-4"} />
        )}
      </button>
    </div>
  );

  return (
    <form className={classNames?.form ?? "space-y-5"} onSubmit={handleSubmit}>
      {label ? (
        <label className={classNames?.label ?? "flex flex-col gap-2 text-sm text-foreground"}>
          {label}
          {field}
        </label>
      ) : (
        field
      )}

      {error && <p className={classNames?.error ?? "error"}>{error}</p>}

      <button
        type="submit"
        disabled={loading || !password}
        className={
          classNames?.submitButton ??
          "interactive-target inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        }
      >
        {loading ? "Unlocking…" : "Unlock"}
        <ArrowRight className={classNames?.submitIcon ?? "h-4 w-4"} />
      </button>
    </form>
  );
}
