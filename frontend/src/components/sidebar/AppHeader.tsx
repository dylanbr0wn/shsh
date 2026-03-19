import { Terminal } from 'lucide-react'

export function AppHeader() {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 px-4">
      <Terminal className="text-primary size-4 shrink-0" />
      <span className="font-mono text-sm font-bold tracking-tight">shsh</span>
    </div>
  )
}
