import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  Settings,
  Plus,
  Download,
  Upload,
  Zap,
} from 'lucide-react'
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from './ui/command'
import {
  hostsAtom,
  isCommandPaletteOpenAtom,
  isQuickConnectOpenAtom,
  isAddHostOpenAtom,
  isSettingsOpenAtom,
  isImportSSHConfigOpenAtom,
  isExportHostsOpenAtom,
  connectingHostIdsAtom,
} from '../store/atoms'
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
  type Workspace,
  type TerminalLeaf,
} from '../store/workspaces'
import { ConnectHost } from '../../wailsjs/go/main/SessionFacade'

export function CommandPalette() {
  const [open, setOpen] = useAtom(isCommandPaletteOpenAtom)
  const hosts = useAtomValue(hostsAtom)
  const setWorkspaces = useSetAtom(workspacesAtom)
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom)
  const setConnectingIds = useSetAtom(connectingHostIdsAtom)
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
  const setIsImportSSHConfigOpen = useSetAtom(isImportSSHConfigOpenAtom)
  const setIsExportHostsOpen = useSetAtom(isExportHostsOpenAtom)

  const close = useCallback(() => setOpen(false), [setOpen])

  const handleConnect = useCallback(
    async (hostId: string, hostLabel: string) => {
      close()
      setConnectingIds((prev) => new Set([...prev, hostId]))
      try {
        const result = await ConnectHost(hostId)
        const paneId = crypto.randomUUID()
        const workspaceId = crypto.randomUUID()
        const leaf: TerminalLeaf = {
          type: 'leaf',
          kind: 'terminal',
          paneId,
          connectionId: result.connectionId,
          channelId: result.channelId,
          hostId,
          hostLabel,
          status: 'connected',
          connectedAt: new Date().toISOString(),
        }
        const workspace: Workspace = {
          id: workspaceId,
          label: hostLabel,
          layout: leaf,
          focusedPaneId: paneId,
        }
        setWorkspaces((prev) => [...prev, workspace])
        setActiveWorkspaceId(workspaceId)
      } catch (err) {
        toast.error('Connection failed', { description: String(err) })
      } finally {
        setConnectingIds((prev) => {
          const next = new Set(prev)
          next.delete(hostId)
          return next
        })
      }
    },
    [close, setConnectingIds, setWorkspaces, setActiveWorkspaceId]
  )

  function runAction(fn: () => void) {
    close()
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder="Search hosts or commands..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {hosts.length > 0 && (
            <CommandGroup heading="Hosts">
              {hosts.map((host) => (
                <CommandItem
                  key={host.id}
                  value={`${host.label} ${host.username}@${host.hostname}`}
                  onSelect={() => handleConnect(host.id, host.label)}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: host.color ?? 'var(--muted-foreground)' }}
                  />
                  <span className="flex-1 truncate">{host.label}</span>
                  <span className="text-muted-foreground truncate font-mono text-xs">
                    {host.username}@{host.hostname}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandSeparator />

          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => runAction(() => setIsQuickConnectOpen(true))}>
              <Zap />
              Quick Connect
              <CommandShortcut>⌘⇧K</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => runAction(() => setIsAddHostOpen(true))}>
              <Plus />
              New Host
              <CommandShortcut>⌘N</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => runAction(() => setIsSettingsOpen(true))}>
              <Settings />
              Settings
            </CommandItem>
            <CommandItem onSelect={() => runAction(() => setIsImportSSHConfigOpen(true))}>
              <Download />
              Import SSH Config
              <CommandShortcut>⌘I</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => runAction(() => setIsExportHostsOpen(true))}>
              <Upload />
              Export Hosts
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
