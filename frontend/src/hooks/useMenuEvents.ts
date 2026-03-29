import { useSetAtom } from 'jotai'
import { useWailsEvent } from './useWailsEvent'
import {
  isQuickConnectOpenAtom,
  isImportHostsOpenAtom,
  isSettingsOpenAtom,
  isAddHostOpenAtom,
  isNewGroupOpenAtom,
  isTerminalProfilesOpenAtom,
  isExportHostsOpenAtom,
  pendingHostKeyAtom,
} from '../store/atoms'

export function useMenuEvents() {
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
  const setIsImportHostsOpen = useSetAtom(isImportHostsOpenAtom)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsNewGroupOpen = useSetAtom(isNewGroupOpenAtom)
  const setIsTerminalProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)
  const setIsExportHostsOpen = useSetAtom(isExportHostsOpenAtom)
  const setPendingHostKey = useSetAtom(pendingHostKeyAtom)

  useWailsEvent('menu:new-connection', () => setIsQuickConnectOpen(true))
  useWailsEvent('menu:import-hosts', () => setIsImportHostsOpen(true))
  useWailsEvent('menu:settings', () => setIsSettingsOpen(true))
  useWailsEvent('menu:add-host', () => setIsAddHostOpen(true))
  useWailsEvent('menu:new-group', () => setIsNewGroupOpen(true))
  useWailsEvent('menu:terminal-profiles', () => setIsTerminalProfilesOpen(true))
  useWailsEvent('menu:export-hosts', () => setIsExportHostsOpen(true))
  useWailsEvent('connection:hostkey', (event) => setPendingHostKey(event))
}
