import { useMemo } from 'react'
import { toast } from 'sonner'
import { Terminal, Zap, Plus, Download, Loader2, ArrowRight } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  hostsAtom,
  connectingHostIdsAtom,
  isQuickConnectOpenAtom,
  isAddHostOpenAtom,
  isImportSSHConfigOpenAtom,
} from '../../store/atoms'
import { workspacesAtom, activeWorkspaceIdAtom, type TerminalLeaf } from '../../store/workspaces'
import { ConnectHost } from '../../../wailsjs/go/main/App'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'
import type { Host } from '../../types'

export function WelcomeScreen() {
  const hosts = useAtomValue(hostsAtom)
  const connectingIds = useAtomValue(connectingHostIdsAtom)
  const setConnectingIds = useSetAtom(connectingHostIdsAtom)
  const setWorkspaces = useSetAtom(workspacesAtom)
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom)
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsImportSSHConfigOpen = useSetAtom(isImportSSHConfigOpenAtom)

  const recentHosts = useMemo(
    () =>
      hosts
        .filter((h) => h.lastConnectedAt != null)
        .sort((a, b) => (b.lastConnectedAt ?? '').localeCompare(a.lastConnectedAt ?? ''))
        .slice(0, 4),
    [hosts]
  )

  async function handleConnect(host: Host) {
    setConnectingIds((prev) => new Set([...prev, host.id]))
    try {
      const result = await ConnectHost(host.id)
      const paneId = crypto.randomUUID()
      const workspaceId = crypto.randomUUID()
      const leaf: TerminalLeaf = {
        type: 'leaf',
        kind: 'terminal',
        paneId,
        connectionId: result.connectionId,
        channelId: result.channelId,
        hostId: host.id,
        hostLabel: host.label,
        status: 'connected',
        connectedAt: new Date().toISOString(),
      }
      setWorkspaces((prev) => [
        ...prev,
        {
          id: workspaceId,
          label: host.label,
          layout: leaf,
          focusedPaneId: paneId,
        },
      ])
      setActiveWorkspaceId(workspaceId)
      setConnectingIds((prev) => {
        const next = new Set(prev)
        next.delete(host.id)
        return next
      })
    } catch (err) {
      setConnectingIds((prev) => {
        const next = new Set(prev)
        next.delete(host.id)
        return next
      })
      toast.error('Connection failed', { description: String(err) })
    }
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {/* Subtle dot-grid texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />

      {/* Content column */}
      <div className="relative flex w-full max-w-[400px] flex-col gap-5 px-6">
        {/* Zone 1 — App identity */}
        <div className="flex items-center gap-2.5">
          <div
            className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md"
            aria-hidden="true"
          >
            <Terminal className="size-4" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-sm font-semibold tracking-tight">shsh</span>
            <span className="text-muted-foreground font-mono text-xs">—&nbsp;ssh client</span>
          </div>
        </div>

        {/* Zone 2 — Quick Connect (primary CTA) */}
        <button
          type="button"
          onClick={() => setIsQuickConnectOpen(true)}
          className={cn(
            'group flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left',
            'border-primary/25 bg-primary/[0.04] transition-colors',
            'hover:border-primary/50 hover:bg-primary/[0.08]',
            'focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none'
          )}
        >
          <div
            className="bg-primary/10 text-primary group-hover:bg-primary/20 flex size-9 shrink-0 items-center justify-center rounded-md transition-colors"
            aria-hidden="true"
          >
            <Zap className="size-4" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold">Quick Connect</span>
            <span className="text-muted-foreground truncate text-xs">
              Connect to any host instantly
            </span>
          </div>
          <ArrowRight
            className="text-primary/40 group-hover:text-primary/70 size-4 shrink-0 transition-all duration-300 group-hover:translate-x-1"
            aria-hidden="true"
          />
        </button>

        {/* Zone 3 — Recent hosts */}
        {recentHosts.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-muted-foreground/60 font-mono text-[10px] font-semibold tracking-widest uppercase">
              Recent
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {recentHosts.map((host) => {
                const isConnecting = connectingIds.has(host.id)
                return (
                  <Tooltip key={host.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => handleConnect(host)}
                        disabled={isConnecting}
                        aria-label={`Connect to ${host.label}`}
                        aria-busy={isConnecting}
                        className={cn(
                          'group flex flex-col gap-1 rounded-md border p-3 text-left transition-colors',
                          'border-border bg-card hover:border-border hover:bg-accent/50',
                          'focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none',
                          'disabled:pointer-events-none disabled:opacity-50'
                        )}
                        style={
                          host.color
                            ? { borderLeftColor: host.color, borderLeftWidth: '2px' }
                            : undefined
                        }
                      >
                        <div className="flex min-w-0 items-center justify-between gap-1">
                          <span className="truncate text-xs font-medium">{host.label}</span>
                          {isConnecting && (
                            <Loader2
                              className="text-muted-foreground size-3 shrink-0 animate-spin"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        <span className="text-muted-foreground truncate font-mono text-[10px]">
                          {host.username}@{host.hostname}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {host.hostname}:{host.port}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        )}

        {/* Divider */}
        <Separator />

        {/* Zone 4 — Secondary actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setIsAddHostOpen(true)}
          >
            <Plus data-icon="inline-start" />
            Add Host
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setIsImportSSHConfigOpen(true)}
          >
            <Download data-icon="inline-start" />
            Import SSH Config
          </Button>
        </div>
      </div>
    </div>
  )
}
