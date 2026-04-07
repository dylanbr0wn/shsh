import { useState, useEffect, useCallback } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { vaultEnabledAtom, biometricAvailableAtom } from '../../atoms/vault'
import {
  SetupVault,
  EnableTouchID,
  DisableTouchID,
  SetLockTimeout,
  LockVault,
  DisableVault,
} from '@wailsjs/go/main/VaultFacade'
import { GetConfig } from '@wailsjs/go/main/App'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { FieldSet, FieldLegend, FieldGroup, Field, FieldLabel, FieldDescription } from '../ui/field'
import { SettingsHeader } from './SettingsHeader'

export function SecuritySettings() {
  const [vaultEnabled, setVaultEnabled] = useAtom(vaultEnabledAtom)
  const biometricAvailable = useAtomValue(biometricAvailableAtom)

  // Setup form state
  const [showSetup, setShowSetup] = useState(false)
  const [setupPassword, setSetupPassword] = useState('')
  const [setupConfirm, setSetupConfirm] = useState('')
  const [setupError, setSetupError] = useState('')
  const [setupLoading, setSetupLoading] = useState(false)

  // Vault settings state
  const [touchIdEnabled, setTouchIdEnabled] = useState(false)
  const [touchIdError, setTouchIdError] = useState('')
  const [lockTimeout, setLockTimeoutValue] = useState('15')
  const [touchIdLoading, setTouchIdLoading] = useState(false)
  const [timeoutLoading, setTimeoutLoading] = useState(false)
  const [timeoutError, setTimeoutError] = useState('')

  // Disable vault state
  const [showDisable, setShowDisable] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [disableError, setDisableError] = useState('')
  const [disableLoading, setDisableLoading] = useState(false)

  useEffect(() => {
    if (vaultEnabled) {
      GetConfig().then((cfg) => {
        if (cfg.vault) {
          setTouchIdEnabled(cfg.vault.touchIdEnabled ?? false)
          setLockTimeoutValue(String(cfg.vault.lockTimeoutMinutes ?? 15))
        }
      })
    }
  }, [vaultEnabled])

  const handleSetupVault = useCallback(async () => {
    setSetupError('')
    if (setupPassword !== setupConfirm) {
      setSetupError('Passwords do not match.')
      return
    }
    if (setupPassword.length < 8) {
      setSetupError('Password must be at least 8 characters.')
      return
    }
    setSetupLoading(true)
    try {
      await SetupVault(setupPassword)
      setVaultEnabled(true)
      setShowSetup(false)
      setSetupPassword('')
      setSetupConfirm('')
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : String(err))
    } finally {
      setSetupLoading(false)
    }
  }, [setupPassword, setupConfirm, setVaultEnabled])

  const handleTouchIdToggle = useCallback(async (enabled: boolean) => {
    setTouchIdLoading(true)
    setTouchIdError('')
    try {
      if (enabled) {
        await EnableTouchID()
      } else {
        await DisableTouchID()
      }
      setTouchIdEnabled(enabled)
    } catch (err) {
      setTouchIdError(err instanceof Error ? err.message : String(err))
    } finally {
      setTouchIdLoading(false)
    }
  }, [])

  const handleTimeoutChange = useCallback(async (value: string) => {
    setTimeoutLoading(true)
    setTimeoutError('')
    try {
      await SetLockTimeout(parseInt(value, 10))
      setLockTimeoutValue(value)
    } catch (err) {
      setTimeoutError(err instanceof Error ? err.message : String(err))
    } finally {
      setTimeoutLoading(false)
    }
  }, [])

  const handleDisableVault = useCallback(async () => {
    setDisableError('')
    setDisableLoading(true)
    try {
      await DisableVault(disablePassword)
      setVaultEnabled(false)
      setShowDisable(false)
      setDisablePassword('')
    } catch (err) {
      setDisableError(err instanceof Error ? err.message : String(err))
    } finally {
      setDisableLoading(false)
    }
  }, [disablePassword, setVaultEnabled])

  if (!vaultEnabled) {
    return (
      <>
        <SettingsHeader title="Security" />
        <FieldSet>
          <FieldLegend>Security</FieldLegend>
          <FieldGroup>
            {!showSetup ? (
              <Field>
                <FieldLabel>Vault Encryption</FieldLabel>
                <FieldDescription>
                  Protect your stored credentials with a master password.
                </FieldDescription>
                <Button variant="outline" onClick={() => setShowSetup(true)}>
                  Set Up Vault Encryption
                </Button>
              </Field>
            ) : (
              <Field>
                <FieldLabel>Set Up Vault Encryption</FieldLabel>
                <FieldDescription>
                  Choose a strong master password. You will need it every time the vault is locked.
                </FieldDescription>
                <div className="flex flex-col gap-3">
                  <Input
                    type="password"
                    placeholder="Master password"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    disabled={setupLoading}
                  />
                  <Input
                    type="password"
                    placeholder="Confirm password"
                    value={setupConfirm}
                    onChange={(e) => setSetupConfirm(e.target.value)}
                    disabled={setupLoading}
                  />
                  {setupError && <p className="text-destructive text-xs">{setupError}</p>}
                  <div className="flex gap-2">
                    <Button
                      onClick={handleSetupVault}
                      disabled={setupLoading || !setupPassword || !setupConfirm}
                    >
                      Enable
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setShowSetup(false)
                        setSetupPassword('')
                        setSetupConfirm('')
                        setSetupError('')
                      }}
                      disabled={setupLoading}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </Field>
            )}
          </FieldGroup>
        </FieldSet>
      </>
    )
  }

  return (
    <>
      <SettingsHeader title="Security" />
      <FieldSet>
        <FieldLegend>Security</FieldLegend>
        <FieldGroup>
          {biometricAvailable && (
            <Field orientation="horizontal">
              <div>
                <FieldLabel>Touch ID</FieldLabel>
                {touchIdError && <p className="text-destructive mt-1 text-xs">{touchIdError}</p>}
              </div>
              <Switch
                checked={touchIdEnabled}
                disabled={touchIdLoading}
                onCheckedChange={handleTouchIdToggle}
              />
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="sec-lock-timeout">Auto-Lock Timeout</FieldLabel>
            <FieldDescription>
              Lock the vault after this many minutes of inactivity.
            </FieldDescription>
            <Select
              value={lockTimeout}
              onValueChange={handleTimeoutChange}
              disabled={timeoutLoading}
            >
              <SelectTrigger id="sec-lock-timeout" className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 minutes</SelectItem>
                <SelectItem value="10">10 minutes</SelectItem>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">60 minutes</SelectItem>
              </SelectContent>
            </Select>
            {timeoutError && <p className="text-destructive text-xs">{timeoutError}</p>}
          </Field>

          <Field>
            <FieldLabel>Lock Now</FieldLabel>
            <FieldDescription>Immediately lock the vault.</FieldDescription>
            <Button variant="outline" onClick={() => LockVault()}>
              Lock Vault
            </Button>
          </Field>

          <Field>
            <FieldLabel>Disable Vault</FieldLabel>
            <FieldDescription>
              Remove vault encryption. All credentials will be stored unencrypted.
            </FieldDescription>
            {!showDisable ? (
              <Button variant="destructive" onClick={() => setShowDisable(true)}>
                Disable Vault
              </Button>
            ) : (
              <div className="flex flex-col gap-3">
                <Input
                  type="password"
                  placeholder="Enter master password to confirm"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  disabled={disableLoading}
                />
                {disableError && <p className="text-destructive text-xs">{disableError}</p>}
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    onClick={handleDisableVault}
                    disabled={disableLoading || !disablePassword}
                  >
                    Confirm Disable
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowDisable(false)
                      setDisablePassword('')
                      setDisableError('')
                    }}
                    disabled={disableLoading}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Field>
        </FieldGroup>
      </FieldSet>
    </>
  )
}
