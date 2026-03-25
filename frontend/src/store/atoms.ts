import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { SearchAddon } from '@xterm/addon-search'
import type { Host, Group, SFTPState, PortForwardPanelState, TerminalProfile } from '../types'
import { workspacesAtom, activeWorkspaceIdAtom } from './workspaces'
import { collectLeaves } from '../lib/paneTree'

export { workspacesAtom, activeWorkspaceIdAtom } from './workspaces'

export const hostsAtom = atom<Host[]>([])
export const groupsAtom = atom<Group[]>([])
export const terminalProfilesAtom = atom<TerminalProfile[]>([])
export const isTerminalProfilesOpenAtom = atom<boolean>(false)
export const groupExpandedAtom = atomWithStorage<Record<string, boolean>>('groupExpanded', {})

// The channelId of the focused pane in the active workspace.
export const focusedChannelIdAtom = atom<string | null>((get) => {
  const id = get(activeWorkspaceIdAtom)
  if (!id) return null
  const ws = get(workspacesAtom).find((w) => w.id === id)
  if (!ws || !ws.focusedPaneId) return null
  const leaf = collectLeaves(ws.layout).find((l) => l.paneId === ws.focusedPaneId)
  return leaf?.channelId ?? null
})
export const isAddHostOpenAtom = atom<boolean>(false)
export const connectingHostIdsAtom = atom<Set<string>>(new Set<string>())
export const isEditHostOpenAtom = atom<boolean>(false)
export const isSettingsOpenAtom = atom<boolean>(false)
export const editingHostAtom = atom<Host | null>(null)

// Map of channelId → SFTPState
export const sftpStateAtom = atom<Record<string, SFTPState>>({})

// Map of connectionId → PortForwardPanelState (ephemeral, connection-scoped)
export const portForwardsAtom = atom<Record<string, PortForwardPanelState>>({})

// Map of channelId → SearchAddon instance (populated by useTerminal, read by TerminalSearch)
export const searchAddonsAtom = atom<Record<string, SearchAddon | null>>({})

// persisted: null = always ask, false = never ask (skip dialog)
export const closeConfirmPrefAtom = atomWithStorage<boolean | null>('closeConfirmPref', null)

// transient: pending action to run if user confirms
export const pendingCloseAtom = atom<(() => void) | null>(null)

export interface PendingHostKey {
  connectionId: string
  fingerprint: string
  isNew: boolean
  hasChanged: boolean
  oldKeyTypes?: string[]
}
export const pendingHostKeyAtom = atom<PendingHostKey | null>(null)

export const isImportSSHConfigOpenAtom = atom<boolean>(false)
export const isExportHostsOpenAtom = atom<boolean>(false)
export const isQuickConnectOpenAtom = atom<boolean>(false)
export const isNewGroupOpenAtom = atom<boolean>(false)

// Ephemeral per-channel profile override: channelId → profileId (undefined = use host/group/global chain)
export const channelProfileOverridesAtom = atom<Record<string, string | undefined>>({})

// Map of channelId → logPath (non-empty means logging is active for that channel)
export const activeLogsAtom = atom<Map<string, string>>(new Map())

export const isLogViewerOpenAtom = atom<boolean>(false)

// null = closed; string = connectionId to add a forward to
export const addPortForwardConnectionIdAtom = atom<string | null>(null)

// hostId → latencyMs (-1 = unreachable, key absent = not yet checked)
export const hostHealthAtom = atom<Record<string, number>>({})

// Set of channelIds that have received output while not active (unread activity)
export const channelActivityAtom = atom<string[]>([])

export const isDeployKeyOpenAtom = atom<boolean>(false)
export const deployKeyHostAtom = atom<Host | null>(null)

export const sidebarCollapsedAtom = atom<boolean>(false)
