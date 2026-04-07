import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, FolderOpen, SquareTerminal } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  hostsAtom,
  connectingHostIdsAtom,
  isCommandPaletteOpenAtom,
  hostHealthAtom,
} from '../../store/atoms'
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
  type TerminalLeaf,
  type SFTPLeaf,
} from '../../store/workspaces'
import { ConnectHost, ConnectForSFTP } from '@wailsjs/go/main/SessionFacade'
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
import { ShortcutKbd } from '../ui/kbd'
import { Spinner } from '../ui/spinner'

const paneTypeToneClasses = {
  terminal:
    'bg-pane-kind-terminal-bg text-pane-kind-terminal-text border-pane-kind-terminal-border',
  sftp: 'bg-pane-kind-sftp-bg text-pane-kind-sftp-text border-pane-kind-sftp-border',
} as const

export function WelcomeScreen() {
  const hosts = useAtomValue(hostsAtom)
  const connectingIds = useAtomValue(connectingHostIdsAtom)
  const setConnectingIds = useSetAtom(connectingHostIdsAtom)
  const setWorkspaces = useSetAtom(workspacesAtom)
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom)
  const setIsCommandPaletteOpen = useSetAtom(isCommandPaletteOpenAtom)
  const health = useAtomValue(hostHealthAtom)
  const [isHostDropActive, setIsHostDropActive] = useState(false)
  const [dropTarget, setDropTarget] = useState<'terminal' | 'sftp' | null>(null)
  const [dropConnecting, setDropConnecting] = useState<{
    kind: 'terminal' | 'sftp'
    hostLabel: string
  } | null>(null)
  const dragDepthRef = useRef(0)

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

  async function handleOpenFiles(host: Host) {
    setConnectingIds((prev) => new Set([...prev, host.id]))
    try {
      const result = await ConnectForSFTP(host.id)
      const paneId = crypto.randomUUID()
      const workspaceId = crypto.randomUUID()
      const leaf: SFTPLeaf = {
        type: 'leaf',
        kind: 'sftp',
        paneId,
        connectionId: result.connectionId,
        channelId: result.channelId,
        hostId: host.id,
        hostLabel: host.label,
        status: 'connected',
      }
      setWorkspaces((prev) => [
        ...prev,
        {
          id: workspaceId,
          label: `${host.label} - Files`,
          layout: leaf,
          focusedPaneId: paneId,
        },
      ])
      setActiveWorkspaceId(workspaceId)
    } catch (err) {
      toast.error('Failed to open files', { description: String(err) })
    } finally {
      setConnectingIds((prev) => {
        const next = new Set(prev)
        next.delete(host.id)
        return next
      })
    }
  }

  function handleHostDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('application/x-shsh-host')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!isHostDropActive) setIsHostDropActive(true)
  }

  function handleHostDragLeave(_e: React.DragEvent<HTMLDivElement>) {
    dragDepthRef.current--
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0
      setIsHostDropActive(false)
      setDropTarget(null)
    }
  }

  function handleHostDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('application/x-shsh-host')) return
    dragDepthRef.current++
    handleHostDragOver(e)
  }

  function resetDropState() {
    dragDepthRef.current = 0
    setIsHostDropActive(false)
    setDropTarget(null)
  }

  function getDraggedHost(e: React.DragEvent): Host | null {
    const raw = e.dataTransfer.getData('application/x-shsh-host')
    if (!raw) return null
    try {
      const { hostId } = JSON.parse(raw) as { hostId?: string }
      if (!hostId) return null
      const host = hosts.find((h) => h.id === hostId)
      if (!host) {
        toast.error('Host not found')
        return null
      }
      return host
    } catch {
      return null
    }
  }

  async function handleDropToTarget(kind: 'terminal' | 'sftp', e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('application/x-shsh-host')) return
    e.preventDefault()
    e.stopPropagation()
    const host = getDraggedHost(e)
    resetDropState()
    if (!host) {
      toast.error('Invalid drag payload')
      return
    }
    setDropConnecting({ kind, hostLabel: host.label })
    try {
      if (kind === 'sftp') {
        await handleOpenFiles(host)
      } else {
        await handleConnect(host)
      }
    } catch (err) {
      toast.error('Invalid drag payload', { description: String(err) })
    } finally {
      setDropConnecting(null)
    }
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      onDragOver={handleHostDragOver}
      onDragEnter={handleHostDragEnter}
      onDragLeave={handleHostDragLeave}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('application/x-shsh-host')) return
        e.preventDefault()
        resetDropState()
      }}
    >
      <div className="flex w-full max-w-100 flex-col gap-5 px-6">
        {dropConnecting || isHostDropActive ? (
          <div className="flex min-h-64 items-center justify-center gap-3">
            <div
              className={`flex-1 transition-opacity ${dropConnecting?.kind === 'sftp' ? 'opacity-30' : 'opacity-100'}`}
              onDragEnter={(e) => {
                if (!e.dataTransfer.types.includes('application/x-shsh-host')) return
                e.preventDefault()
                if (dropConnecting) return
                setDropTarget('terminal')
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('application/x-shsh-host')) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                if (dropConnecting) return
                if (dropTarget !== 'terminal') setDropTarget('terminal')
              }}
              onDrop={(e) => {
                if (dropConnecting) return
                void handleDropToTarget('terminal', e)
              }}
            >
              <div
                className={`welcome-drop-zone text-muted-foreground flex min-h-44 flex-col items-center justify-center gap-2 rounded-lg border border-dashed transition-colors ${
                  !dropConnecting && dropTarget === 'terminal'
                    ? 'welcome-drop-zone-active'
                    : 'hover:bg-muted/20'
                } ${
                  dropConnecting?.kind === 'terminal' ||
                  (!dropConnecting && dropTarget === 'terminal')
                    ? paneTypeToneClasses.terminal
                    : ''
                }`}
              >
                <SquareTerminal className="size-7" />
                <div className="text-center">
                  <p className="text-foreground text-sm font-medium">
                    {dropConnecting?.kind === 'terminal'
                      ? 'Opening SSH session'
                      : 'Open SSH session'}
                  </p>
                  <p className="text-xs">
                    {dropConnecting?.kind === 'terminal'
                      ? dropConnecting.hostLabel
                      : 'Drop host to open terminal'}
                  </p>
                </div>
                {dropConnecting?.kind === 'terminal' && <Spinner />}
              </div>
            </div>
            <div
              className={`flex-1 transition-opacity ${dropConnecting?.kind === 'terminal' ? 'opacity-30' : 'opacity-100'}`}
              onDragEnter={(e) => {
                if (!e.dataTransfer.types.includes('application/x-shsh-host')) return
                e.preventDefault()
                if (dropConnecting) return
                setDropTarget('sftp')
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('application/x-shsh-host')) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                if (dropConnecting) return
                if (dropTarget !== 'sftp') setDropTarget('sftp')
              }}
              onDrop={(e) => {
                if (dropConnecting) return
                void handleDropToTarget('sftp', e)
              }}
            >
              <div
                className={`welcome-drop-zone text-muted-foreground flex min-h-44 flex-col items-center justify-center gap-2 rounded-lg border border-dashed transition-colors ${
                  !dropConnecting && dropTarget === 'sftp'
                    ? 'welcome-drop-zone-active'
                    : 'hover:bg-muted/20'
                } ${
                  dropConnecting?.kind === 'sftp' || (!dropConnecting && dropTarget === 'sftp')
                    ? paneTypeToneClasses.sftp
                    : ''
                }`}
              >
                <FolderOpen className="size-7" />
                <div className="text-center">
                  <p className="text-foreground text-sm font-medium">
                    {dropConnecting?.kind === 'sftp' ? 'Opening SFTP session' : 'Open SFTP session'}
                  </p>
                  <p className="text-xs">
                    {dropConnecting?.kind === 'sftp'
                      ? dropConnecting.hostLabel
                      : 'Drop host to open files'}
                  </p>
                </div>
                {dropConnecting?.kind === 'sftp' && <Spinner />}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Branding */}
            <div className="flex flex-col gap-0.5">
              <span className="text-primary font-mono text-sm font-semibold tracking-tight">
                shsh
              </span>
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
                  <ShortcutKbd shortcut="CmdOrCtrl+k" />
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
                      <Item key={host.id} asChild variant="muted">
                        <button type="button" onClick={() => handleConnect(host)}>
                          <ItemContent>
                            <ItemTitle className="truncate text-sm font-medium">
                              {host.label}
                            </ItemTitle>
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
          </>
        )}
      </div>
    </div>
  )
}
