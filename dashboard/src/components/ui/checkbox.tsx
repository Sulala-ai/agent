import * as React from "react"
import { cn } from "@/lib/utils"

interface CheckboxProps extends Omit<React.ComponentPropsWithoutRef<"input">, "type"> {
  onCheckedChange?: (checked: boolean | "indeterminate") => void
}

function Checkbox({ className, checked, onCheckedChange, onChange, ...props }: CheckboxProps) {
  const isChecked = checked === true
  return (
    <input
      type="checkbox"
      checked={isChecked}
      onChange={(e) => {
        onChange?.(e)
        onCheckedChange?.(e.target.checked)
      }}
      data-slot="checkbox"
      className={cn(
        "border-input size-4 shrink-0 rounded border transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2",
        "accent-primary disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Checkbox }
