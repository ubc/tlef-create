import { GripVertical } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"
import "../../styles/components/ui/resizable.css"

import { cn } from "../../lib/utils"

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn("resizable-panel-group", className)}
    {...props}
  />
)

const ResizablePanel = ResizablePrimitive.Panel

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn("resizable-handle", className)}
    {...props}
  >
    {withHandle && (
      <div className="resizable-handle-grip">
        <GripVertical className="resizable-handle-icon" />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
