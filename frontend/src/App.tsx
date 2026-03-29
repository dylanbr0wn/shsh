import { useEffect, useState, useCallback, useRef } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
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
  const debugPanelOpen = useAtomValue(debugPanelOpenAtom)
  const [debugHeight, setDebugHeight] = useState(300)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startY: e.clientY, startHeight: debugHeight }
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current || !containerRef.current) return
        const containerHeight = containerRef.current.getBoundingClientRect().height
        const delta = dragRef.current.startY - ev.clientY
        const next = Math.min(
          Math.max(dragRef.current.startHeight + delta, 150),
          containerHeight * 0.8
        )
        setDebugHeight(next)
      }
      const onUp = () => {
        dragRef.current = null
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [debugHeight]
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
            <ResizableHandle />
            <ResizablePanel defaultSize="82%" className="min-h-0 overflow-hidden">
              <div ref={containerRef} className="relative h-full">
                <ErrorBoundary
                  fallback="panel"
                  zone="main"
                  onError={(e, i) => reportUIError(e, i, 'main')}
                >
                  <MainArea />
                </ErrorBoundary>
                {debugPanelOpen && (
                  <div
                    className="absolute inset-x-0 bottom-0 z-10 flex flex-col"
                    style={{ height: debugHeight }}
                  >
                    {/* Drag handle */}
                    <div
                      onMouseDown={onDragStart}
                      className="bg-border hover:bg-primary/50 h-1 shrink-0 cursor-row-resize transition-colors"
                    />
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
