import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import type { Host, Group, TerminalProfile } from '../types'
import { ListHosts, ListGroups, ListTerminalProfiles } from '@wailsjs/go/main/HostFacade'
import { Environment } from '@wailsjs/runtime/runtime'
import { hostsAtom, groupsAtom, terminalProfilesAtom, isMacAtom } from './atoms'
import { useDebugEvents } from '../hooks/useDebugEvents'
import { useChannelEvents } from '../hooks/useChannelEvents'
import { useConnectionEvents } from '../hooks/useConnectionEvents'
import { useMenuEvents } from '../hooks/useMenuEvents'
import { useSessionMenuEvents } from '../hooks/useSessionMenuEvents'

export function useAppInit() {
  const setHosts = useSetAtom(hostsAtom)
  const setGroups = useSetAtom(groupsAtom)
  const setTerminalProfiles = useSetAtom(terminalProfilesAtom)
  const setIsMac = useSetAtom(isMacAtom)

  useEffect(() => {
    Environment().then((env: unknown) =>
      setIsMac((env as { platform: string }).platform === 'darwin')
    )
    ListHosts()
      .then((hosts) => setHosts(hosts as unknown as Host[]))
      .catch((err: unknown) => toast.error('Failed to load hosts', { description: String(err) }))
    ListGroups()
      .then((groups) => setGroups(groups as unknown as Group[]))
      .catch((err: unknown) => toast.error('Failed to load groups', { description: String(err) }))
    ListTerminalProfiles()
      .then((profiles: unknown) => setTerminalProfiles(profiles as unknown as TerminalProfile[]))
      .catch((err: unknown) =>
        toast.error('Failed to load terminal profiles', { description: String(err) })
      )
  }, [setHosts, setGroups, setTerminalProfiles, setIsMac])

  useDebugEvents()
  useChannelEvents()
  useConnectionEvents()
  useMenuEvents()
  useSessionMenuEvents()
}
