import { Plus, Terminal, FolderOpen, HardDrive } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { hostsAtom } from '../../store/atoms'
import { Button } from '../ui/button'
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
  onAddLocal: () => void
  onAddTerminal: (hostId: string) => void
  onAddSFTP: (hostId: string) => void
}

export function AddPaneMenu({ onAddLocal, onAddTerminal, onAddSFTP }: Props) {
  const hosts = useAtomValue(hostsAtom)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" title="Add pane">
          <Plus className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onAddLocal}>
          <HardDrive className="mr-2 size-4" />
          Local Files
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Terminal className="mr-2 size-4" />
            Terminal
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {hosts.map((host) => (
              <DropdownMenuItem key={host.id} onSelect={() => onAddTerminal(host.id)}>
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
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderOpen className="mr-2 size-4" />
            SFTP
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {hosts.map((host) => (
              <DropdownMenuItem key={host.id} onSelect={() => onAddSFTP(host.id)}>
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
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
