export type AuthMethod = 'password' | 'key' | 'agent'
export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface Group {
  id: string
  name: string
  sortOrder: number
  createdAt: string
}

export interface CreateGroupInput {
  name: string
}

export interface UpdateGroupInput {
  id: string
  name: string
  sortOrder: number
}

export interface Host {
  id: string
  label: string
  hostname: string
  port: number
  username: string
  authMethod: AuthMethod
  createdAt: string
  lastConnectedAt?: string
  groupId?: string
  color?: string
  tags?: string[]
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
  groupId?: string
  color?: string
  tags?: string[]
}

export interface UpdateHostInput {
  id: string
  label: string
  hostname: string
  port: number
  username: string
  authMethod: AuthMethod
  password?: string
  groupId?: string
  color?: string
  tags?: string[]
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

export interface PortForward {
  id: string
  localPort: number
  remoteHost: string
  remotePort: number
}

export interface PortForwardPanelState {
  isOpen: boolean
  forwards: PortForward[]
  isAdding: boolean
  error: string | null
}
