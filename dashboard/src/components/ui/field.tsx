import * as React from "react";
import { cn } from "@/lib/utils";

const Field = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { orientation?: "vertical" | "horizontal" }
>(({ className, orientation = "vertical", ...props }, ref) => (
  <div
    ref={ref}
    role="group"
    data-slot="field"
    className={cn(
      orientation === "horizontal"
        ? "flex flex-row items-center gap-2"
        : "flex flex-col gap-1.5",
      className
    )}
    {...props}
  />
));
Field.displayName = "Field";

function FieldLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"label">) {
  return (
    <label
      data-slot="field-label"
      className={cn(
        "text-foreground text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  );
}

function FieldDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-muted-foreground text-xs", className)}
      {...props}
    />
  );
}

function FieldError({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn("text-destructive text-xs", className)}
      {...props}
    />
  );
}

export { Field, FieldDescription, FieldError, FieldLabel };
