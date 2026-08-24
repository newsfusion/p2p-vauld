import type { ReactNode } from "react";

type StatusBadgeVariant = "success" | "warning" | "destructive" | "primary";

const VARIANT_CLASSES: Record<StatusBadgeVariant, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  primary: "bg-primary/10 text-primary",
};

interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  children?: ReactNode;
  className?: string;
}

export function StatusBadge({
  variant,
  children,
  className = "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
}: StatusBadgeProps) {
  return (
    <span className={[className, VARIANT_CLASSES[variant]].join(" ")}>
      {children}
    </span>
  );
}
