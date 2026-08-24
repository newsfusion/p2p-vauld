import { Sparkles, X } from "lucide-react";

export function GeminiActivationBanner({
  onOpenSettings,
  onDismiss,
}: {
  onOpenSettings: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold text-foreground">
            Activate Gemini Nano for better extraction
          </p>
          <p className="mt-1 text-muted-foreground">
            Chrome built-in AI can improve portfolio scraping and runs locally in
            your browser.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          data-testid="gemini-banner-open-settings"
          onClick={onOpenSettings}
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Open Settings
        </button>
        <button
          type="button"
          data-testid="gemini-banner-dismiss"
          aria-label="Dismiss Gemini Nano banner"
          onClick={onDismiss}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
