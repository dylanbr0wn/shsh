import { GripVertical } from 'lucide-react'
import * as ResizablePrimitive from 'react-resizable-panels'

import { cn } from '@/lib/utils'

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  className,
  withHandle = true,
  ...props
}: ResizablePrimitive.SeparatorProps & { withHandle?: boolean }) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        withHandle
          ? 'bg-border group hover:bg-primary data-[separator=active]:bg-primary relative flex w-px items-center justify-center outline-hidden transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90'
          : 'hover:bg-primary/20 data-[separator=active]:bg-primary/20 relative flex w-1.5 shrink-0 items-center justify-center bg-transparent outline-hidden transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 aria-[orientation=horizontal]:h-1.5 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-3 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2',
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border text-muted-foreground/40 group-hover:bg-primary group-hover:text-primary-foreground group-data-[separator=active]:bg-primary group-data-[separator=active]:text-primary-foreground z-10 flex h-8 shrink-0 items-center justify-center rounded-lg transition-colors">
          <GripVertical className="size-3 shrink-0" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
