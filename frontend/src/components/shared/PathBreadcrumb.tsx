import { Home } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface PathBreadcrumbProps {
  path: string
  onNavigate: (path: string) => void
  maxVisible?: number
  className?: string
}

export function PathBreadcrumb({
  path,
  onNavigate,
  maxVisible = 5,
  className,
}: PathBreadcrumbProps) {
  const segments = path.split('/').filter(Boolean)

  // How many trailing segments to always show (maxVisible minus root)
  const tailCount = maxVisible - 1
  const shouldCollapse = segments.length > tailCount

  const collapsedSegments = shouldCollapse ? segments.slice(0, segments.length - tailCount) : []
  const visibleSegments = shouldCollapse ? segments.slice(segments.length - tailCount) : segments
  const visibleOffset = shouldCollapse ? segments.length - tailCount : 0

  function pathForIndex(idx: number) {
    return '/' + segments.slice(0, idx + 1).join('/')
  }

  return (
    <Breadcrumb className={cn(className)}>
      <BreadcrumbList>
        {/* Root */}
        <BreadcrumbItem>
          <BreadcrumbLink
            className="cursor-pointer"
            onClick={() => onNavigate('/')}
            aria-label="Go to root"
          >
            <Home className="size-4" />
          </BreadcrumbLink>
        </BreadcrumbItem>

        {/* Collapsed segments dropdown */}
        {shouldCollapse && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1" aria-label="Show more">
                  <BreadcrumbEllipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {collapsedSegments.map((seg, idx) => (
                    <DropdownMenuItem key={idx} onClick={() => onNavigate(pathForIndex(idx))}>
                      {seg}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
          </>
        )}

        {/* Visible segments */}
        {visibleSegments.map((seg, idx) => {
          const absoluteIdx = visibleOffset + idx
          const isLast = absoluteIdx === segments.length - 1

          return (
            <span key={absoluteIdx} className="contents">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{seg}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    className="cursor-pointer"
                    onClick={() => onNavigate(pathForIndex(absoluteIdx))}
                  >
                    {seg}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
