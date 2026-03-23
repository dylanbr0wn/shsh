import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle, Copy, Info } from 'lucide-react'
import { GenerateSSHKey } from '../../../wailsjs/go/main/App'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Field, FieldError, FieldGroup, FieldLabel } from '../ui/field'

type KeyType = 'ed25519' | 'rsa-4096' | 'rsa-2048'

const DEFAULT_PATHS: Record<KeyType, string> = {
  ed25519: '~/.ssh/id_ed25519',
  'rsa-4096': '~/.ssh/id_rsa',
  'rsa-2048': '~/.ssh/id_rsa',
}

interface FormState {
  keyType: KeyType
  savePath: string
  comment: string
  passphrase: string
  passphraseConfirm: string
}

interface SuccessState {
  privateKeyPath: string
  publicKeyPath: string
  publicKeyText: string
}

interface ValidationErrors {
  savePath?: string
  passphraseConfirm?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onGenerated: (privateKeyPath: string) => void
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="text-muted-foreground/60 size-3 shrink-0 cursor-help" />
      </TooltipTrigger>
      <TooltipContent className="max-w-56">{children}</TooltipContent>
    </Tooltip>
  )
}

export function GenerateKeyModal({ open, onClose, onGenerated }: Props) {
  const [form, setForm] = useState<FormState>({
    keyType: 'ed25519',
    savePath: DEFAULT_PATHS['ed25519'],
    comment: '',
    passphrase: '',
    passphraseConfirm: '',
  })
  const [pathEdited, setPathEdited] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [success, setSuccess] = useState<SuccessState | null>(null)

  // Reset when opening
  useEffect(() => {
    if (open) {
      setForm({
        keyType: 'ed25519',
        savePath: DEFAULT_PATHS['ed25519'],
        comment: '',
        passphrase: '',
        passphraseConfirm: '',
      })
      setPathEdited(false)
      setErrors({})
      setSuccess(null)
    }
  }, [open])

  // Auto-update save path when key type changes (unless user edited it)
  useEffect(() => {
    if (!pathEdited) {
      setForm((f) => ({ ...f, savePath: DEFAULT_PATHS[f.keyType] }))
    }
  }, [form.keyType, pathEdited])

  function validate(): ValidationErrors {
    const e: ValidationErrors = {}
    if (!form.savePath.trim()) e.savePath = 'Save path is required'
    if (form.passphrase && form.passphrase !== form.passphraseConfirm) {
      e.passphraseConfirm = 'Passphrases do not match'
    }
    return e
  }

  async function handleGenerate() {
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    setGenerating(true)
    try {
      const [keyType, rsaBits] =
        form.keyType === 'ed25519'
          ? (['ed25519', 0] as const)
          : (['rsa', form.keyType === 'rsa-4096' ? 4096 : 2048] as const)
      const result = await GenerateSSHKey({
        keyType,
        rsaBits,
        savePath: form.savePath,
        passphrase: form.passphrase,
        comment: form.comment,
      })
      setSuccess({
        privateKeyPath: result.privateKeyPath,
        publicKeyPath: result.publicKeyPath,
        publicKeyText: result.publicKeyText,
      })
    } catch (err) {
      toast.error('Key generation failed', { description: String(err) })
    } finally {
      setGenerating(false)
    }
  }

  function handleUseKey() {
    if (success) {
      onGenerated(success.privateKeyPath)
    }
  }

  async function handleCopyPublicKey() {
    if (!success) return
    try {
      await navigator.clipboard.writeText(success.publicKeyText)
      toast.success('Public key copied to clipboard')
    } catch {
      toast.error('Failed to copy to clipboard')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Generate SSH Key</DialogTitle>
          <DialogDescription>Create a new key pair and save it to disk.</DialogDescription>
        </DialogHeader>

        {success ? (
          <>
            <DialogBody>
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="size-4 shrink-0 text-green-500" />
                  <span>Key pair generated successfully</span>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-muted-foreground text-xs font-medium">Private key</p>
                  <p className="font-mono text-xs break-all">{success.privateKeyPath}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <p className="text-muted-foreground text-xs font-medium">Public key</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={handleCopyPublicKey}
                    >
                      <Copy className="size-3" />
                      Copy
                    </Button>
                  </div>
                  <pre className="bg-muted text-muted-foreground rounded-md p-2 font-mono text-[10px] break-all whitespace-pre-wrap">
                    {success.publicKeyText}
                  </pre>
                </div>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button type="button" onClick={handleUseKey}>
                Use This Key
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="gk-type">Key Type</FieldLabel>
                  <Select
                    value={form.keyType}
                    onValueChange={(val) => setForm((f) => ({ ...f, keyType: val as KeyType }))}
                  >
                    <SelectTrigger id="gk-type" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ed25519">Ed25519 (recommended)</SelectItem>
                      <SelectItem value="rsa-4096">RSA 4096-bit</SelectItem>
                      <SelectItem value="rsa-2048">RSA 2048-bit</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="gk-path">
                    Save Path
                    <FieldHint>
                      Where to save the private key file. The public key is saved at the same path
                      with a .pub extension.
                    </FieldHint>
                  </FieldLabel>
                  <Input
                    id="gk-path"
                    value={form.savePath}
                    onChange={(e) => {
                      setPathEdited(true)
                      setForm((f) => ({ ...f, savePath: e.target.value }))
                    }}
                    placeholder="~/.ssh/id_ed25519"
                  />
                  {errors.savePath && <FieldError>{errors.savePath}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="gk-comment">
                    Comment
                    <FieldHint>
                      Optional label appended to the public key — usually your email or machine
                      name.
                    </FieldHint>
                  </FieldLabel>
                  <Input
                    id="gk-comment"
                    value={form.comment}
                    onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                    placeholder="user@machine (optional)"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="gk-passphrase">
                    Passphrase
                    <FieldHint>
                      Encrypts the private key on disk. Leave blank for an unencrypted key.
                    </FieldHint>
                  </FieldLabel>
                  <Input
                    id="gk-passphrase"
                    type="password"
                    value={form.passphrase}
                    onChange={(e) => setForm((f) => ({ ...f, passphrase: e.target.value }))}
                    placeholder="Leave blank for no passphrase"
                  />
                </Field>

                {form.passphrase && (
                  <Field>
                    <FieldLabel htmlFor="gk-passphrase-confirm">Confirm Passphrase</FieldLabel>
                    <Input
                      id="gk-passphrase-confirm"
                      type="password"
                      value={form.passphraseConfirm}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, passphraseConfirm: e.target.value }))
                      }
                      placeholder="Re-enter passphrase"
                    />
                    {errors.passphraseConfirm && (
                      <FieldError>{errors.passphraseConfirm}</FieldError>
                    )}
                  </Field>
                )}
              </FieldGroup>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={handleGenerate} disabled={generating}>
                {generating ? 'Generating…' : 'Generate Key'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
