import type { ReactNode } from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { XIcon } from 'lucide-react'

export function SettingsHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center gap-2">
        {actions}
        <DialogClose asChild>
          <Button variant="ghost" size="icon-sm">
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
        </DialogClose>
      </div>
    </div>
  )
}
