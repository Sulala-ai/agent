import * as React from "react"
import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentPropsWithoutRef<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "text-foreground text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  )
}

export { Label }
