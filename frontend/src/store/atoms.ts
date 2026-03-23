import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { SearchAddon } from '@xterm/addon-search'
import type {
  Host,
  Group,
  Session,
  SFTPState,
  PortForwardPanelState,
  TerminalProfile,
} from '../types'

export const hostsAtom = atom<Host[]>([])
export const groupsAtom = atom<Group[]>([])
export const terminalProfilesAtom = atom<TerminalProfile[]>([])
export const isTerminalProfilesOpenAtom = atom<boolean>(false)
export const groupExpandedAtom = atomWithStorage<Record<string, boolean>>('groupExpanded', {})
export const sessionsAtom = atom<Session[]>([])
export const activeSessionIdAtom = atom<string | null>(null)
export const isAddHostOpenAtom = atom<boolean>(false)
export const connectingHostIdsAtom = atom<Set<string>>(new Set<string>())
export const isEditHostOpenAtom = atom<boolean>(false)
export const isSettingsOpenAtom = atom<boolean>(false)
export const editingHostAtom = atom<Host | null>(null)

// Map of sessionId → SFTPState
export const sftpStateAtom = atom<Record<string, SFTPState>>({})

// Map of sessionId → PortForwardPanelState (ephemeral, session-scoped)
export const portForwardsAtom = atom<Record<string, PortForwardPanelState>>({})

// Map of sessionId → SearchAddon instance (populated by useTerminal, read by TerminalSearch)
export const searchAddonsAtom = atom<Record<string, SearchAddon | null>>({})

// persisted: null = always ask, false = never ask (skip dialog)
export const closeConfirmPrefAtom = atomWithStorage<boolean | null>('closeConfirmPref', null)

// transient: pending action to run if user confirms
export const pendingCloseAtom = atom<(() => void) | null>(null)

export interface PendingHostKey {
  sessionId: string
  fingerprint: string
  isNew: boolean
  hasChanged: boolean
}
export const pendingHostKeyAtom = atom<PendingHostKey | null>(null)

export const isImportSSHConfigOpenAtom = atom<boolean>(false)
export const isExportHostsOpenAtom = atom<boolean>(false)
export const isQuickConnectOpenAtom = atom<boolean>(false)
export const isNewGroupOpenAtom = atom<boolean>(false)

// Ephemeral per-session profile override: sessionId → profileId (undefined = use host/group/global chain)
export const sessionProfileOverridesAtom = atom<Record<string, string | undefined>>({})

// Map of sessionId → logPath (non-empty means logging is active for that session)
export const activeLogsAtom = atom<Map<string, string>>(new Map())

export const isLogViewerOpenAtom = atom<boolean>(false)

// null = closed; string = sessionId to add a forward to
export const addPortForwardSessionIdAtom = atom<string | null>(null)

// hostId → latencyMs (-1 = unreachable, key absent = not yet checked)
export const hostHealthAtom = atom<Record<string, number>>({})

// Set of sessionIds that have received output while not active (unread activity)
export const sessionActivityAtom = atom<string[]>([])
