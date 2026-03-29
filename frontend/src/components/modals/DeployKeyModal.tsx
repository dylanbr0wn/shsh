import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, KeyRound } from 'lucide-react'
import { BrowseKeyFile, DeployPublicKey, ReadPublicKeyText } from '@wailsjs/go/main/KeysFacade'
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
import { Field, FieldGroup, FieldLabel } from '../ui/field'
import { GenerateKeyModal } from './GenerateKeyModal'
import { Spinner } from '../ui/spinner'

interface Props {
  open: boolean
  onClose: () => void
  hostId: string
  hostLabel: string
}

export function DeployKeyModal({ open, onClose, hostId, hostLabel }: Props) {
  const [keyPath, setKeyPath] = useState('')
  const [pubKeyText, setPubKeyText] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [generateKeyOpen, setGenerateKeyOpen] = useState(false)

  // Reset state when dialog opens.
  useEffect(() => {
    if (open) {
      setKeyPath('')
      setPubKeyText(null)
    }
  }, [open])

  // Load public key text preview whenever keyPath changes.
  useEffect(() => {
    if (!keyPath) {
      setPubKeyText(null)
      return
    }
    ReadPublicKeyText(keyPath)
      .then(setPubKeyText)
      .catch(() => setPubKeyText(null))
  }, [keyPath])

  async function handleBrowse() {
    setBrowsing(true)
    try {
      const path = await BrowseKeyFile()
      if (path) setKeyPath(path)
    } catch {
      // user cancelled
    } finally {
      setBrowsing(false)
    }
  }

  async function handleDeploy() {
    setDeploying(true)
    try {
      const fingerprint = await DeployPublicKey(hostId, keyPath)
      toast.success('Public key deployed', { description: fingerprint })
      onClose()
    } catch (err) {
      toast.error('Deploy failed', { description: String(err) })
    } finally {
      setDeploying(false)
    }
  }

  // Show a truncated preview: first 20 chars + last 10 chars.
  const keyPreview = pubKeyText
    ? pubKeyText.slice(0, 20) + '…' + pubKeyText.slice(-10).trim()
    : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deploy Public Key</DialogTitle>
          <DialogDescription>Install a public key on {hostLabel}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="dk-key-path">Public Key</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="dk-key-path"
                  placeholder="~/.ssh/id_ed25519"
                  value={keyPath}
                  onChange={(e) => setKeyPath(e.target.value)}
                  className="flex-1"
                />
                <Button type="button" variant="outline" disabled={browsing} onClick={handleBrowse}>
                  <FolderOpen data-icon="inline-start" />
                  Browse
                </Button>
                <Button type="button" variant="outline" onClick={() => setGenerateKeyOpen(true)}>
                  <KeyRound data-icon="inline-start" />
                  Generate…
                </Button>
              </div>
            </Field>
          </FieldGroup>

          <GenerateKeyModal
            open={generateKeyOpen}
            onClose={() => setGenerateKeyOpen(false)}
            onGenerated={(path) => {
              setKeyPath(path)
              setGenerateKeyOpen(false)
            }}
          />

          {/* Transparency block */}
          <div className="bg-muted/50 text-muted-foreground mt-4 space-y-1 rounded-md p-3 text-xs">
            <p className="text-foreground font-medium">This will connect to {hostLabel} and:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>Ensure ~/.ssh exists with permissions 700</li>
              <li>Append your public key to ~/.ssh/authorized_keys (if not already present)</li>
              <li>Set permissions 600 on ~/.ssh/authorized_keys</li>
            </ul>
            <p className="mt-2 font-mono text-[10px] break-all">
              {keyPreview ? (
                <>Key: {keyPreview}</>
              ) : (
                <span className="italic opacity-60">Select a key above to preview</span>
              )}
            </p>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleDeploy} disabled={!keyPath || deploying}>
            {deploying && <Spinner data-icon="inline-start" />}
            Deploy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
