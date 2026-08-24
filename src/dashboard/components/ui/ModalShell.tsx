import type { ReactNode } from "react";

interface ModalShellProps {
  titleId: string;
  descriptionId?: string;
  panelClassName: string;
  children?: ReactNode;
}

export function ModalShell({
  titleId,
  descriptionId,
  panelClassName,
  children,
}: ModalShellProps) {
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      {...(descriptionId ? { "aria-describedby": descriptionId } : {})}
    >
      <div className={[panelClassName, "modal-pop"].join(" ")}>{children}</div>
    </div>
  );
}
