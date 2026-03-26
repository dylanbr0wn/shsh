import { useMemo } from 'react'
import { toast } from 'sonner'
import { Loader2, ArrowRight, BookOpen } from 'lucide-react'
import { DOCS_BASE_URL } from '../../lib/constants'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  hostsAtom,
  connectingHostIdsAtom,
  isQuickConnectOpenAtom,
  isAddHostOpenAtom,
  isImportSSHConfigOpenAtom,
  hostHealthAtom,
} from '../../store/atoms'
import { workspacesAtom, activeWorkspaceIdAtom, type TerminalLeaf } from '../../store/workspaces'
import { ConnectHost } from '../../../wailsjs/go/main/SessionFacade'
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
  const health = useAtomValue(hostHealthAtom)

  const recentHosts = useMemo(
    () =>
      hosts
        .filter((h) => h.lastConnectedAt != null)
        .sort((a, b) => (b.lastConnectedAt ?? '').localeCompare(a.lastConnectedAt ?? ''))
        .slice(0, 6),
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
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex w-full max-w-[400px] flex-col gap-5 px-6">
        {/* Branding */}
        <div className="flex flex-col gap-0.5">
          <span className="text-primary font-mono text-sm font-semibold tracking-tight">
            shsh
          </span>
          <span className="text-muted-foreground text-xs">Secure Shell Hub</span>
        </div>

        {/* Search/Connect bar */}
        <button
          type="button"
          onClick={() => setIsQuickConnectOpen(true)}
          className="border-border bg-card hover:border-primary/30 flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowRight className="text-primary size-3.5 shrink-0" />
          <span className="text-muted-foreground flex-1 text-sm">
            Quick connect...
          </span>
          <kbd className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>

        {/* Recent hosts */}
        {recentHosts.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-muted-foreground/60 font-mono text-[10px] font-semibold tracking-widest uppercase">
              Recent
            </h2>
            <div className="flex flex-col gap-1">
              {recentHosts.map((host, index) => {
                const isConnecting = connectingIds.has(host.id)
                const latency = health[host.id]
                const isReachable = latency !== undefined && latency >= 0
                return (
                  <button
                    key={host.id}
                    type="button"
                    onClick={() => handleConnect(host)}
                    disabled={isConnecting}
                    className="host-item-animate bg-card hover:bg-accent flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                    style={{
                      borderLeft: `2.5px solid ${host.color ?? 'transparent'}`,
                      paddingLeft: 9,
                      animation: 'host-item-in 200ms ease-out both',
                      animationDelay: `${Math.min(index, 8) * 40}ms`,
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{host.label}</span>
                      <span className="text-muted-foreground truncate font-mono text-xs">
                        {host.username}@{host.hostname}
                      </span>
                    </div>
                    {isConnecting ? (
                      <Loader2 className="text-muted-foreground size-3 shrink-0 animate-spin" />
                    ) : (
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          isReachable ? 'bg-green-500' : 'bg-muted-foreground/30'
                        }`}
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground font-mono text-xs">
            {'>'} no recent connections
          </p>
        )}

        {/* Keyboard shortcuts */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsQuickConnectOpen(true)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          >
            <kbd className="bg-muted rounded px-1 font-mono text-[10px]">⌘K</kbd>
            Quick Connect
          </button>
          <button
            type="button"
            onClick={() => setIsAddHostOpen(true)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          >
            <kbd className="bg-muted rounded px-1 font-mono text-[10px]">⌘N</kbd>
            New Host
          </button>
          <button
            type="button"
            onClick={() => setIsImportSSHConfigOpen(true)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          >
            <kbd className="bg-muted rounded px-1 font-mono text-[10px]">⌘I</kbd>
            Import
          </button>
          <button
            type="button"
            onClick={() => window.open(DOCS_BASE_URL, '_blank')}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          >
            <BookOpen className="size-3" />
            Docs
          </button>
        </div>
      </div>
    </div>
  )
}
