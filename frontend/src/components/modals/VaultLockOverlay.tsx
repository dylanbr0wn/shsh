import { useState, useEffect, useCallback, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { vaultLockedAtom, biometricAvailableAtom } from '../../atoms/vault'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Lock, Fingerprint } from 'lucide-react'
import { UnlockVault, UnlockVaultBiometric } from '@wailsjs/go/main/VaultFacade'

export function VaultLockOverlay() {
  const [vaultLocked, setVaultLocked] = useAtom(vaultLockedAtom)
  const biometricAvailable = useAtomValue(biometricAvailableAtom)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [unlocking, setUnlocking] = useState(false)

  const handleBiometric = useCallback(async () => {
    setError('')
    setUnlocking(true)
    try {
      await UnlockVaultBiometric()
      setVaultLocked(false)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUnlocking(false)
    }
  }, [setVaultLocked])

  const handlePassword = useCallback(async () => {
    if (!password) return
    setError('')
    setUnlocking(true)
    try {
      await UnlockVault(password)
      setVaultLocked(false)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUnlocking(false)
    }
  }, [password, setVaultLocked])

  // Auto-trigger biometric once when the overlay first appears.
  const biometricTriggered = useRef(false)
  useEffect(() => {
    if (vaultLocked && biometricAvailable && !biometricTriggered.current) {
      biometricTriggered.current = true
      handleBiometric()
    }
    if (!vaultLocked) {
      biometricTriggered.current = false
    }
  }, [vaultLocked, biometricAvailable, handleBiometric])

  if (!vaultLocked) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Blurred backdrop */}
      <div className="bg-background/80 absolute inset-0 backdrop-blur-sm" />

      {/* Lock dialog card */}
      <div className="bg-card text-card-foreground relative flex w-80 flex-col items-center gap-6 rounded-lg border p-8 shadow-lg">
        <div className="bg-muted flex size-12 items-center justify-center rounded-full">
          <Lock className="text-muted-foreground size-6" />
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
          <h2 className="text-lg font-semibold">Vault Locked</h2>
          <p className="text-muted-foreground text-sm">Enter your master password to unlock.</p>
        </div>

        <div className="flex w-full flex-col gap-3">
          <Input
            type="password"
            placeholder="Master password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePassword()}
            disabled={unlocking}
          />

          {error && <p className="text-destructive text-xs">{error}</p>}

          <Button onClick={handlePassword} disabled={unlocking || !password} className="w-full">
            Unlock
          </Button>

          {biometricAvailable && (
            <Button
              variant="outline"
              onClick={handleBiometric}
              disabled={unlocking}
              className="w-full"
            >
              <Fingerprint data-icon="inline-start" />
              Use Touch ID
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
