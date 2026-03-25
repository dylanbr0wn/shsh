export type AuthMethod = 'password' | 'key' | 'agent'
export type CredentialSource = 'inline' | '1password' | 'bitwarden'

export interface PMStatus {
  available: boolean
  locked: boolean
  error?: string
}

export interface PasswordManagersStatus {
  onePassword: PMStatus
  bitwarden: PMStatus
}
export type SessionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'failed'
  | 'error'
export type CursorStyle = 'block' | 'underline' | 'bar'

export interface TerminalProfile {
  id: string
  name: string
  fontSize: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  scrollback: number
  colorTheme: string
  createdAt: string
}

export interface Group {
  id: string
  name: string
  sortOrder: number
  createdAt: string
  terminalProfileId?: string
}

export interface CreateGroupInput {
  name: string
}

export interface UpdateGroupInput {
  id: string
  name: string
  sortOrder: number
  terminalProfileId?: string
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
  terminalProfileId?: string
  keyPath?: string
  jumpHostId?: string
  credentialSource?: CredentialSource
  credentialRef?: string
  reconnectEnabled?: boolean
  reconnectMaxRetries?: number
  reconnectInitialDelaySeconds?: number
  reconnectMaxDelaySeconds?: number
  keepAliveIntervalSeconds?: number
  keepAliveMaxMissed?: number
}

export interface CreateHostInput {
  label: string
  hostname: string
  port: number
  username: string
  authMethod: AuthMethod
  password?: string
  keyPath?: string
  keyPassphrase?: string
  groupId?: string
  color?: string
  tags?: string[]
  terminalProfileId?: string
  jumpHostId?: string
  credentialSource?: CredentialSource
  credentialRef?: string
  reconnectEnabled?: boolean
  reconnectMaxRetries?: number
  reconnectInitialDelaySeconds?: number
  reconnectMaxDelaySeconds?: number
  keepAliveIntervalSeconds?: number
  keepAliveMaxMissed?: number
}

export interface UpdateHostInput {
  id: string
  label: string
  hostname: string
  port: number
  username: string
  authMethod: AuthMethod
  password?: string
  keyPath?: string
  keyPassphrase?: string
  groupId?: string
  color?: string
  tags?: string[]
  terminalProfileId?: string
  jumpHostId?: string
  credentialSource?: CredentialSource
  credentialRef?: string
  reconnectEnabled?: boolean
  reconnectMaxRetries?: number
  reconnectInitialDelaySeconds?: number
  reconnectMaxDelaySeconds?: number
  keepAliveIntervalSeconds?: number
  keepAliveMaxMissed?: number
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
  forwards: PortForward[]
}

export interface LogFileInfo {
  path: string
  filename: string
  hostLabel: string
  createdAt: string
  sizeBytes: number
}

// --- Workspace Templates ---

export type TemplateTerminalLeaf = {
  kind: 'terminal'
  hostId: string
}

export type TemplateSFTPLeaf = {
  kind: 'sftp'
  hostId: string
}

export type TemplateLocalLeaf = {
  kind: 'local'
  defaultPath?: string
}

export type TemplateLeaf = TemplateTerminalLeaf | TemplateSFTPLeaf | TemplateLocalLeaf

export type TemplateSplitNode = {
  direction: 'horizontal' | 'vertical'
  ratio: number
  left: TemplateNode
  right: TemplateNode
}

export type TemplateNode = TemplateLeaf | TemplateSplitNode

export interface WorkspaceTemplate {
  id: string
  name: string
  layout: TemplateNode
}
