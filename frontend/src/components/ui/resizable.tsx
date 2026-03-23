import * as ResizablePrimitive from 'react-resizable-panels'
import { ChevronLeft, ChevronRight } from 'lucide-react'

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
  withHandle,
  onToggle,
  isCollapsed,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
  onToggle?: () => void
  isCollapsed?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        'bg-border group relative flex w-px items-center justify-center outline-hidden after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 hover:bg-indigo-500/40 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 data-[separator=active]:bg-indigo-500 [&[aria-orientation=horizontal]>div]:rotate-90',
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border z-10 flex h-6 w-1 shrink-0 rounded-lg group-hover:bg-indigo-500/40 group-data-[separator=active]:bg-indigo-500" />
      )}
      {onToggle && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className="bg-sidebar border-border absolute z-20 flex h-5 w-5 items-center justify-center rounded-full border transition-colors hover:border-indigo-500/50 hover:bg-indigo-500/20"
          aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </button>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
