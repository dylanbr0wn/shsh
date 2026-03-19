import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { Host, Session, SFTPState } from '../types'

export const hostsAtom = atom<Host[]>([])
export const sessionsAtom = atom<Session[]>([])
export const activeSessionIdAtom = atom<string | null>(null)
export const isAddHostOpenAtom = atom<boolean>(false)
export const connectingHostIdsAtom = atom<Set<string>>(new Set<string>())
export const isEditHostOpenAtom = atom<boolean>(false)
export const isSettingsOpenAtom = atom<boolean>(false)
export const editingHostAtom = atom<Host | null>(null)

// Map of sessionId → SFTPState
export const sftpStateAtom = atom<Record<string, SFTPState>>({})

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
