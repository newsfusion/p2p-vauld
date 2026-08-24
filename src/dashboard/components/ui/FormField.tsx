import type { InputHTMLAttributes, ReactNode } from "react";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  children?: ReactNode;
  labelClassName?: string;
  fieldClassName?: string;
}

export function FormField({
  id,
  label,
  children,
  labelClassName = "text-xs font-medium text-muted-foreground",
  fieldClassName = "space-y-1.5",
  ...inputProps
}: FormFieldProps) {
  return (
    <div className={fieldClassName}>
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      {children ?? <input id={id} {...inputProps} />}
    </div>
  );
}
