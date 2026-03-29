import { useEffect, useState, useCallback, useRef } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { useTheme } from 'next-themes'
import { usePanelRef } from 'react-resizable-panels'
import { TooltipProvider } from './components/ui/tooltip'
import { Toaster } from './components/ui/sonner'
import { useAppInit } from './store/useAppInit'
import { Sidebar } from './components/layout/Sidebar'
import { MainArea } from './components/layout/MainArea'
import { TitleBar } from './components/layout/TitleBar'
import { AddHostModal } from './components/modals/AddHostModal'
import { EditHostModal } from './components/modals/EditHostModal'
import { SettingsModal } from './components/modals/SettingsModal'
import { HostKeyDialog } from './components/modals/HostKeyDialog'
import { ImportHostsModal } from './components/modals/ImportHostsModal'
import { ExportHostsModal } from './components/modals/ExportHostsModal'
import { QuickConnectModal } from './components/modals/QuickConnectModal'
import { CommandPalette } from './components/CommandPalette'
import { StatusBar } from './components/layout/StatusBar'
import { LogViewerModal } from './components/modals/LogViewerModal'
import { AddPortForwardModal } from './components/modals/AddPortForwardModal'
import { TerminalProfilesModal } from './components/modals/TerminalProfilesModal'
import { DeployKeyModal } from './components/modals/DeployKeyModal'
import { VaultLockOverlay } from './components/modals/VaultLockOverlay'
import { GripHorizontal } from 'lucide-react'
import { cn } from './lib/utils'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable'
import { DebugPanel } from './components/debug/DebugPanel'
import { isDeployKeyOpenAtom, deployKeyHostAtom, sidebarCollapsedAtom } from './store/atoms'
import { vaultLockedAtom, vaultEnabledAtom, biometricAvailableAtom } from './atoms/vault'
import { debugPanelOpenAtom } from './store/debugStore'
import { ErrorBoundary } from './components/ErrorBoundary'
import { reportUIError } from './lib/reportUIError'
import {
  IsVaultEnabled,
  IsVaultLocked,
  IsBiometricAvailable,
  LockVault,
} from '../wailsjs/go/main/VaultFacade'
import { EventsOn } from '../wailsjs/runtime/runtime'

export default function App() {
  useAppInit()
  const { resolvedTheme } = useTheme()
  const sidebarRef = usePanelRef()
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const [isDeployKeyOpen, setIsDeployKeyOpen] = useAtom(isDeployKeyOpenAtom)
  const [debugPanelOpen, setDebugPanelOpen] = useAtom(debugPanelOpenAtom)
  const [debugHeight, setDebugHeight] = useState(300)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const SNAP_CLOSE_THRESHOLD = 80
  const inSnapZone = dragging && debugHeight < SNAP_CLOSE_THRESHOLD

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startY: e.clientY, startHeight: debugHeight }
      setDragging(true)
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current || !containerRef.current) return
        const containerHeight = containerRef.current.getBoundingClientRect().height
        const delta = dragRef.current.startY - ev.clientY
        const raw = dragRef.current.startHeight + delta
        const next = Math.min(Math.max(raw, 0), containerHeight * 0.8)
        setDebugHeight(next)
      }
      const onUp = () => {
        dragRef.current = null
        setDragging(false)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        // Snap closed if dragged below threshold
        setDebugHeight((h) => {
          if (h < SNAP_CLOSE_THRESHOLD) {
            setDebugPanelOpen(false)
            return 300 // reset for next open
          }
          return Math.max(h, 150) // enforce minimum
        })
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [debugHeight, setDebugPanelOpen]
  )
  const [vaultEnabled, setVaultEnabled] = useAtom(vaultEnabledAtom)
  const setVaultLocked = useSetAtom(vaultLockedAtom)
  const setBiometricAvailable = useSetAtom(biometricAvailableAtom)

  useEffect(() => {
    IsVaultEnabled().then((enabled: boolean) => {
      setVaultEnabled(enabled)
      if (enabled) {
        IsVaultLocked().then((locked: boolean) => setVaultLocked(locked))
      }
    })
    IsBiometricAvailable().then((available: boolean) => setBiometricAvailable(available))
    const cancel = EventsOn('vault:locked', () => setVaultLocked(true))
    return () => cancel?.()
  }, [setVaultEnabled, setVaultLocked, setBiometricAvailable])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'l') {
        e.preventDefault()
        if (vaultEnabled) LockVault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [vaultEnabled])

  useEffect(() => {
    if (sidebarCollapsed) {
      sidebarRef.current?.collapse()
    } else {
      sidebarRef.current?.expand()
    }
  }, [sidebarCollapsed, sidebarRef])
  const [deployKeyHost] = useAtom(deployKeyHostAtom)

  return (
    <TooltipProvider delayDuration={400}>
      <ErrorBoundary
        fallback="fullscreen"
        zone="app"
        onError={(e, i) => reportUIError(e, i, 'app')}
      >
        <div className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
          <VaultLockOverlay />
          <ErrorBoundary
            fallback="inline"
            zone="titlebar"
            onError={(e, i) => reportUIError(e, i, 'titlebar')}
          >
            <TitleBar />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="command-palette"
            onError={(e, i) => reportUIError(e, i, 'command-palette')}
          >
            <CommandPalette />
          </ErrorBoundary>
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
            <ResizablePanel
              panelRef={sidebarRef}
              defaultSize="20%"
              minSize="340px"
              maxSize="40%"
              collapsible
              collapsedSize="0%"
              onResize={(size) => setSidebarCollapsed(size.inPixels === 0)}
              className="flex flex-col"
            >
              <ErrorBoundary
                fallback="panel"
                zone="sidebar"
                onError={(e, i) => reportUIError(e, i, 'sidebar')}
              >
                <Sidebar />
              </ErrorBoundary>
            </ResizablePanel>
            <ResizableHandle className="z-20" />
            <ResizablePanel defaultSize="82%" className="min-h-0 overflow-hidden">
              <div ref={containerRef} className="relative h-full">
                <ErrorBoundary
                  fallback="panel"
                  zone="main"
                  onError={(e, i) => reportUIError(e, i, 'main')}
                >
                  <MainArea />
                </ErrorBoundary>
                {/* Snap guide — shows at bottom edge when dragging into close zone */}
                {inSnapZone && (
                  <div className="border-muted-foreground/30 pointer-events-none absolute inset-x-0 bottom-0 z-20 border-b" />
                )}
                {debugPanelOpen && (
                  <div
                    className={cn(
                      'absolute inset-x-0 bottom-0 z-10 flex flex-col transition-opacity',
                      inSnapZone ? 'opacity-40' : 'opacity-100'
                    )}
                    style={{ height: debugHeight }}
                  >
                    {/* Drag handle — horizontal, matches ResizableHandle style */}
                    {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                    <div
                      onMouseDown={onDragStart}
                      className={cn(
                        'group relative flex h-px w-full shrink-0 cursor-row-resize items-center justify-center transition-colors after:absolute after:left-0 after:h-2 after:w-full after:-translate-y-1/2',
                        dragging ? 'bg-primary' : 'bg-border hover:bg-primary'
                      )}
                    >
                      <div
                        className={cn(
                          'z-10 flex w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                          dragging
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-border text-muted-foreground/40 group-hover:bg-primary group-hover:text-primary-foreground'
                        )}
                      >
                        <GripHorizontal className="size-3 shrink-0" />
                      </div>
                    </div>
                    <ErrorBoundary
                      fallback="inline"
                      zone="debug"
                      onError={(e, i) => reportUIError(e, i, 'debug')}
                    >
                      <DebugPanel />
                    </ErrorBoundary>
                  </div>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
          <ErrorBoundary
            fallback="inline"
            zone="statusbar"
            onError={(e, i) => reportUIError(e, i, 'statusbar')}
          >
            <StatusBar />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="modal-add-host"
            onError={(e, i) => reportUIError(e, i, 'modal-add-host')}
          >
            <AddHostModal />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="modal-edit-host"
            onError={(e, i) => reportUIError(e, i, 'modal-edit-host')}
          >
            <EditHostModal />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="modal-settings"
            onError={(e, i) => reportUIError(e, i, 'modal-settings')}
          >
            <SettingsModal />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="modal-host-key"
            onError={(e, i) => reportUIError(e, i, 'modal-host-key')}
          >
            <HostKeyDialog />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="modal-import-ssh"
            onError={(e, i) => reportUIError(e, i, 'modal-import-ssh')}
          >
            <ImportHostsModal />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="modal-export-hosts"
            onError={(e, i) => reportUIError(e, i, 'modal-export-hosts')}
          >
            <ExportHostsModal />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="modal-quick-connect"
            onError={(e, i) => reportUIError(e, i, 'modal-quick-connect')}
          >
            <QuickConnectModal />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="modal-log-viewer"
            onError={(e, i) => reportUIError(e, i, 'modal-log-viewer')}
          >
            <LogViewerModal />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="modal-add-port-forward"
            onError={(e, i) => reportUIError(e, i, 'modal-add-port-forward')}
          >
            <AddPortForwardModal />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="modal-terminal-profiles"
            onError={(e, i) => reportUIError(e, i, 'modal-terminal-profiles')}
          >
            <TerminalProfilesModal />
          </ErrorBoundary>
          <ErrorBoundary
            fallback="inline"
            zone="modal-deploy-key"
            onError={(e, i) => reportUIError(e, i, 'modal-deploy-key')}
          >
            <DeployKeyModal
              open={isDeployKeyOpen}
              onClose={() => setIsDeployKeyOpen(false)}
              hostId={deployKeyHost?.id ?? ''}
              hostLabel={deployKeyHost?.label ?? ''}
            />
          </ErrorBoundary>
        </div>
      </ErrorBoundary>
      <Toaster position="bottom-right" theme={resolvedTheme as 'light' | 'dark'} />
    </TooltipProvider>
  )
}
