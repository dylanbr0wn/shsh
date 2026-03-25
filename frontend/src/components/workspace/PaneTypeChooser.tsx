import { Terminal, FolderOpen, HardDrive } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { hostsAtom } from '../../store/atoms'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

interface Props {
  /** The trigger element (split button) */
  children: React.ReactNode
  /** Current pane's hostId — pre-selected at top of host submenus */
  currentHostId: string
  onSelectTerminal: (hostId: string) => void
  onSelectSFTP: (hostId: string) => void
  onSelectLocal: () => void
}

export function PaneTypeChooser({
  children,
  currentHostId,
  onSelectTerminal,
  onSelectSFTP,
  onSelectLocal,
}: Props) {
  const hosts = useAtomValue(hostsAtom)
  const currentHost = hosts.find((h) => h.id === currentHostId)
  const otherHosts = hosts.filter((h) => h.id !== currentHostId)

  function renderHostList(onSelect: (hostId: string) => void) {
    return (
      <>
        {currentHost && (
          <>
            <DropdownMenuItem onSelect={() => onSelect(currentHost.id)}>
              {currentHost.color && (
                <span
                  className="mr-2 inline-block size-2 rounded-full"
                  style={{ backgroundColor: currentHost.color }}
                />
              )}
              Current: {currentHost.label}
            </DropdownMenuItem>
            {otherHosts.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {otherHosts.map((host) => (
          <DropdownMenuItem key={host.id} onSelect={() => onSelect(host.id)}>
            {host.color && (
              <span
                className="mr-2 inline-block size-2 rounded-full"
                style={{ backgroundColor: host.color }}
              />
            )}
            {host.label}
          </DropdownMenuItem>
        ))}
        {hosts.length === 0 && (
          <DropdownMenuItem disabled>No hosts configured</DropdownMenuItem>
        )}
      </>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Terminal className="mr-2 size-4" />
            Terminal
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {renderHostList(onSelectTerminal)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderOpen className="mr-2 size-4" />
            SFTP
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {renderHostList(onSelectSFTP)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSelectLocal}>
          <HardDrive className="mr-2 size-4" />
          Local Files
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
