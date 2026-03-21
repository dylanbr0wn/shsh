import { useTheme } from 'next-themes'
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
import { QuickConnectModal } from './components/modals/QuickConnectModal'
import { LogViewerModal } from './components/modals/LogViewerModal'
import { AddPortForwardModal } from './components/modals/AddPortForwardModal'
import { TerminalProfilesModal } from './components/modals/TerminalProfilesModal'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable'

export default function App() {
  useAppInit()
  const { resolvedTheme } = useTheme()

  return (
    <TooltipProvider delayDuration={400}>
      <div className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
        <TitleBar />
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          <ResizablePanel defaultSize="20%" minSize="320px" maxSize="40%" className="flex flex-col">
            <Sidebar />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="82%" className="flex flex-col">
            <MainArea />
          </ResizablePanel>
        </ResizablePanelGroup>
        <AddHostModal />
        <EditHostModal />
        <SettingsModal />
        <HostKeyDialog />
        <ImportSSHConfigModal />
        <QuickConnectModal />
        <LogViewerModal />
        <AddPortForwardModal />
        <TerminalProfilesModal />
      </div>
      <Toaster position="bottom-right" theme={resolvedTheme as 'light' | 'dark'} />
    </TooltipProvider>
  )
}
