import { useEffect } from 'react'
import { useAtom, useAtomValue } from 'jotai'
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
import { ImportSSHConfigModal } from './components/modals/ImportSSHConfigModal'
import { ExportHostsModal } from './components/modals/ExportHostsModal'
import { QuickConnectModal } from './components/modals/QuickConnectModal'
import { LogViewerModal } from './components/modals/LogViewerModal'
import { AddPortForwardModal } from './components/modals/AddPortForwardModal'
import { TerminalProfilesModal } from './components/modals/TerminalProfilesModal'
import { DeployKeyModal } from './components/modals/DeployKeyModal'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable'
import { DebugPanel } from './components/debug/DebugPanel'
import { isDeployKeyOpenAtom, deployKeyHostAtom, sidebarCollapsedAtom } from './store/atoms'
import { debugPanelOpenAtom } from './store/debugStore'

export default function App() {
  useAppInit()
  const { resolvedTheme } = useTheme()
  const sidebarRef = usePanelRef()
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const [isDeployKeyOpen, setIsDeployKeyOpen] = useAtom(isDeployKeyOpenAtom)
  const debugPanelOpen = useAtomValue(debugPanelOpenAtom)

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
      <div className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
        <TitleBar />
        <ResizablePanelGroup orientation="vertical" className="flex-1">
          <ResizablePanel defaultSize="100%" minSize="30%">
            <ResizablePanelGroup orientation="horizontal" className="h-full">
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
                <Sidebar />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize="82%" className="flex flex-col">
                <MainArea />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle className={debugPanelOpen ? '' : 'hidden'} />
          <ResizablePanel
            defaultSize="0%"
            minSize={debugPanelOpen ? '15%' : '0%'}
            maxSize="60%"
            collapsible
            collapsedSize="0%"
            className={debugPanelOpen ? '' : 'hidden'}
          >
            <DebugPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
        <AddHostModal />
        <EditHostModal />
        <SettingsModal />
        <HostKeyDialog />
        <ImportSSHConfigModal />
        <ExportHostsModal />
        <QuickConnectModal />
        <LogViewerModal />
        <AddPortForwardModal />
        <TerminalProfilesModal />
        <DeployKeyModal
          open={isDeployKeyOpen}
          onClose={() => setIsDeployKeyOpen(false)}
          hostId={deployKeyHost?.id ?? ''}
          hostLabel={deployKeyHost?.label ?? ''}
        />
      </div>
      <Toaster position="bottom-right" theme={resolvedTheme as 'light' | 'dark'} />
    </TooltipProvider>
  )
}
