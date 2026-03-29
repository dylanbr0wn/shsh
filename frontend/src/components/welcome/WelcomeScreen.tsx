import { useMemo } from 'react'
import { toast } from 'sonner'
import { ArrowRight, BookOpen } from 'lucide-react'
import { DOCS_BASE_URL } from '../../lib/constants'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  hostsAtom,
  connectingHostIdsAtom,
  isQuickConnectOpenAtom,
  isAddHostOpenAtom,
  isImportSSHConfigOpenAtom,
  isCommandPaletteOpenAtom,
  hostHealthAtom,
} from '../../store/atoms'
import { workspacesAtom, activeWorkspaceIdAtom, type TerminalLeaf } from '../../store/workspaces'
import { ConnectHost } from '../../../wailsjs/go/main/SessionFacade'
import type { Host } from '../../types'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '../ui/item'
import { Kbd } from '../ui/kbd'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'
import { ButtonGroup } from '../ui/button-group'

export function WelcomeScreen() {
  const hosts = useAtomValue(hostsAtom)
  const connectingIds = useAtomValue(connectingHostIdsAtom)
  const setConnectingIds = useSetAtom(connectingHostIdsAtom)
  const setWorkspaces = useSetAtom(workspacesAtom)
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom)
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsImportSSHConfigOpen = useSetAtom(isImportSSHConfigOpenAtom)
  const setIsCommandPaletteOpen = useSetAtom(isCommandPaletteOpenAtom)
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
      <div className="flex w-full max-w-100 flex-col gap-5 px-6">
        {/* Branding */}
        <div className="flex flex-col gap-0.5">
          <span className="text-primary font-mono text-sm font-semibold tracking-tight">shsh</span>
          <span className="text-muted-foreground text-xs">Secure Shell Hub</span>
        </div>

        {/* Search/Connect bar */}
        <Item variant="outline" size="sm" asChild>
          <button type="button" onClick={() => setIsCommandPaletteOpen(true)}>
            <ItemMedia>
              <ArrowRight className="text-primary size-3.5 shrink-0" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Search...</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </ItemActions>
          </button>
        </Item>

        {/* Recent hosts */}
        {recentHosts.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-muted-foreground/60 font-mono text-[10px] font-semibold tracking-widest uppercase">
              Recent
            </h2>
            <ItemGroup className="gap-1">
              {recentHosts.map((host) => {
                const isConnecting = connectingIds.has(host.id)
                const latency = health[host.id]
                const isReachable = latency !== undefined && latency >= 0
                return (
                  <Item
                    key={host.id}
                    asChild
                    variant="muted"
                    // disabled={isConnecting}
                    // className="host-item-animate bg-card hover:bg-accent focus-visible:ring-ring/50 flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                    // style={{
                    //   borderLeft: `2.5px solid ${host.color ?? 'transparent'}`,
                    //   paddingLeft: 9,
                    //   animation: 'host-item-in 200ms ease-out both',
                    //   animationDelay: `${Math.min(index, 8) * 40}ms`,
                    // }}
                  >
                    <button type="button" onClick={() => handleConnect(host)}>
                      <ItemContent>
                        <ItemTitle className="truncate text-sm font-medium">{host.label}</ItemTitle>
                        <ItemDescription className="text-muted-foreground truncate font-mono text-xs">
                          {host.username}@{host.hostname}
                        </ItemDescription>
                      </ItemContent>
                      <ItemContent>
                        {isConnecting ? (
                          <Spinner className="text-muted-foreground size-3 shrink-0" />
                        ) : (
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${
                              isReachable ? 'bg-green-500' : 'bg-muted-foreground/30'
                            }`}
                          />
                        )}
                      </ItemContent>
                    </button>
                  </Item>
                )
              })}
            </ItemGroup>
          </div>
        ) : (
          <p className="text-muted-foreground font-mono text-xs">{'>'} no recent connections</p>
        )}

        {/* Keyboard shortcuts */}
        <ButtonGroup>
          <Button type="button" variant="ghost" onClick={() => setIsCommandPaletteOpen(true)} size="xs">
            <Kbd>⌘K</Kbd>
            Search
          </Button>
          <Button type="button" variant="ghost" onClick={() => setIsQuickConnectOpen(true)} size="xs">
            <Kbd>⌘⇧K</Kbd>
            Quick Connect
          </Button>
          <Button type="button" variant="ghost" onClick={() => setIsAddHostOpen(true)} size="xs">
            <Kbd>⌘N</Kbd>
            New Host
          </Button>
          <Button type="button" variant="ghost" onClick={() => setIsImportSSHConfigOpen(true)} size="xs">
            <Kbd>⌘I</Kbd>
            Import
          </Button>
          <Button type="button" variant="ghost" onClick={() => window.open(DOCS_BASE_URL, '_blank')} size="xs">
            <BookOpen className="size-3" />
            Docs
          </Button>
        </ButtonGroup>
      </div>
    </div>
  )
}
