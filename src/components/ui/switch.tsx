import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import "../../styles/components/ui/switch.css"

import { cn } from "../../lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn("switch", className)}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn("switch-thumb")}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
