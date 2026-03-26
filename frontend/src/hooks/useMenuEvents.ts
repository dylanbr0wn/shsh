import { useSetAtom } from 'jotai'
import { useWailsEvent } from './useWailsEvent'
import {
  isQuickConnectOpenAtom,
  isImportSSHConfigOpenAtom,
  isSettingsOpenAtom,
  isAddHostOpenAtom,
  isNewGroupOpenAtom,
  isTerminalProfilesOpenAtom,
  isExportHostsOpenAtom,
  pendingHostKeyAtom,
} from '../store/atoms'

export function useMenuEvents() {
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
  const setIsImportSSHConfigOpen = useSetAtom(isImportSSHConfigOpenAtom)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsNewGroupOpen = useSetAtom(isNewGroupOpenAtom)
  const setIsTerminalProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)
  const setIsExportHostsOpen = useSetAtom(isExportHostsOpenAtom)
  const setPendingHostKey = useSetAtom(pendingHostKeyAtom)

  useWailsEvent('menu:new-connection', () => setIsQuickConnectOpen(true))
  useWailsEvent('menu:import-ssh-config', () => setIsImportSSHConfigOpen(true))
  useWailsEvent('menu:settings', () => setIsSettingsOpen(true))
  useWailsEvent('menu:add-host', () => setIsAddHostOpen(true))
  useWailsEvent('menu:new-group', () => setIsNewGroupOpen(true))
  useWailsEvent('menu:terminal-profiles', () => setIsTerminalProfilesOpen(true))
  useWailsEvent('menu:export-hosts', () => setIsExportHostsOpen(true))
  useWailsEvent('connection:hostkey', (event) => setPendingHostKey(event))
}
