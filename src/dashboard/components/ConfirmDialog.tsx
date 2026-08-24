import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const trigger = document.activeElement;
    cancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancelRef.current();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl modal-pop">
        <div className="mb-4">
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            {title}
          </h2>
          {body && (
            <p id={bodyId} className="mt-2 text-sm leading-6 text-muted-foreground">
              {body}
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={[
              "inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-50",
              destructive
                ? "bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground",
            ].join(" ")}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
