export type AuthMethod = 'password' | 'key' | 'agent'
export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface Host {
  id: string
  label: string
  hostname: string
  port: number
  username: string
  authMethod: AuthMethod
  createdAt: string
  lastConnectedAt?: string
}

export interface Session {
  id: string
  hostId: string
  hostLabel: string
  status: SessionStatus
  connectedAt?: string
}

export interface CreateHostInput {
  label: string
  hostname: string
  port: number
  username: string
  authMethod: AuthMethod
  password?: string
}

export interface UpdateHostInput {
  id: string
  label: string
  hostname: string
  port: number
  username: string
  authMethod: AuthMethod
  password?: string
}

export interface SFTPEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modTime: string
  mode: string
}

export interface SFTPState {
  isOpen: boolean
  currentPath: string
  entries: SFTPEntry[]
  isLoading: boolean
  error: string | null
}
