import { ShieldCheck, ShieldOff } from 'lucide-react'
import type { CredentialSource, PasswordManagersStatus } from '../../types'

export function PMStatusBadge({
  status,
  source,
}: {
  status: PasswordManagersStatus | null
  source: CredentialSource
}) {
  if (!status) return null
  const pm = source === '1password' ? status.onePassword : status.bitwarden
  if (!pm.available) {
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        <ShieldOff className="size-3" />
        {pm.error ?? 'CLI not found'}
      </span>
    )
  }
  if (pm.locked) {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-500">
        <ShieldOff className="size-3" />
        {pm.error ?? 'Locked'}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-emerald-500">
      <ShieldCheck className="size-3" />
      Unlocked
    </span>
  )
}
