import { X } from 'lucide-react'
import { Badge } from './badge'

interface TagProps {
  label: string
  onRemove?: () => void
}

export function Tag({ label, onRemove }: TagProps) {
  return (
    <Badge
      // className={cn(
      //   'inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground',
      //   className
      // )}
      variant="default"
    >
      {label}
      {onRemove && (
        <button type="button" onClick={onRemove} className="cursor-pointer">
          <X className="size-3" />
        </button>
      )}
    </Badge>
  )
}
