import type { SessionStatus } from '../types'
import type { PendingHostKey } from '../store/atoms'

export interface WailsEventMap {
  'channel:status': {
    channelId: string
    connectionId: string
    kind: string
    status: SessionStatus
    error?: string
  }
  'connection:status': {
    connectionId: string
    status: 'reconnecting' | 'connected' | 'failed' | 'disconnected'
    attempt?: number
    maxRetries?: number
    error?: string
  }
  'connection:hostkey': PendingHostKey
  'menu:new-connection': void
  'menu:import-ssh-config': void
  'menu:settings': void
  'menu:add-host': void
  'menu:new-group': void
  'menu:terminal-profiles': void
  'menu:export-hosts': void
  'menu:session:disconnect': void
  'menu:session:disconnect-all': void
  'menu:session:add-port-forward': void
  'menu:session:start-log': void
  'menu:session:stop-log': void
  'menu:session:view-logs': void
  'menu:session:open-logs-folder': void
}
