import { useState } from "react";
import { KeyRound, ShieldAlert, CheckCircle2, X } from "lucide-react";
import type { ManualActionRequest } from "../../shared/types/index.js";
import { FormField, ModalShell } from "./ui/index.js";
export type { ManualActionRequest } from "../../shared/types/index.js";

interface ManualActionModalProps {
  request: ManualActionRequest;
  onSubmit: (code?: string) => void;
  onCancel: () => void;
  /** Reason the last confirmation attempt failed, if any. */
  error?: string | undefined;
  /** Continue the sync without verifying the login state (captcha only). */
  onForceContinue?: (() => void) | undefined;
}

export function ManualActionModal({
  request,
  onSubmit,
  onCancel,
  error,
  onForceContinue,
}: ManualActionModalProps) {
  const [code, setCode] = useState("");
  const is2FA = request.actionType === "2fa";
  // The override is a last resort — only offer it once a normal confirmation
  // has actually failed, and never for 2FA (continuing without a live session
  // would just extract from a logged-out page).
  const showForceContinue = !is2FA && error !== undefined && onForceContinue !== undefined;
  const titleId = "manual-action-modal-title";
  const descriptionId = "manual-action-modal-description";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (is2FA && !code.trim()) return;
    onSubmit(is2FA ? code.trim() : undefined);
  };

  return (
    <ModalShell
      titleId={titleId}
      descriptionId={descriptionId}
      panelClassName="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl"
    >
      <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${is2FA ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-500'}`}>
              {is2FA ? <KeyRound className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                {request.platformName}
              </p>
              <h2 id={titleId} className="text-lg font-bold text-foreground mt-0.5">
                {is2FA ? "Two-Factor Authentication" : "Security Verification"}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition rounded-lg p-1 hover:bg-muted"
            aria-label="Cancel sync"
          >
            <X className="h-5 w-5" />
          </button>
      </div>

      <p id={descriptionId} className="text-sm text-muted-foreground mb-5">
        {request.message || (is2FA
          ? "Enter the security code to proceed with the synchronization."
          : "Please solve the security challenge in the opened platform tab.")}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {is2FA && (
          <FormField
            id="otp-code"
            label="2FA / Security Code"
            labelClassName="text-xs font-medium text-muted-foreground"
            fieldClassName="space-y-1.5"
          >
              <input
                id="otp-code"
                type="text"
                autoFocus
                placeholder="e.g. 123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg border border-input bg-background font-mono text-center text-lg tracking-wider focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
              />
          </FormField>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-10 rounded-lg border border-border hover:bg-muted text-sm font-semibold text-muted-foreground hover:text-foreground transition"
          >
            Cancel Sync
          </button>
          <button
            type="submit"
            className="flex-1 h-10 rounded-lg bg-primary hover:bg-primary/90 text-sm font-semibold text-primary-foreground transition flex items-center justify-center gap-2 shadow-sm shadow-primary/20"
          >
            <CheckCircle2 className="h-4 w-4" />
            {is2FA ? "Submit Code" : "Done / Solved"}
          </button>
        </div>

        {error !== undefined && (
          <p
            role="alert"
            className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2"
          >
            {error}
          </p>
        )}

        {showForceContinue && (
          <button
            type="button"
            onClick={onForceContinue}
            className="w-full h-10 rounded-lg border border-border hover:bg-muted text-sm font-semibold text-muted-foreground hover:text-foreground transition"
          >
            Continue anyway
          </button>
        )}
      </form>
    </ModalShell>
  );
}
