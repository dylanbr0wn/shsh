import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  isEditHostOpenAtom,
  editingHostAtom,
  hostsAtom,
  groupsAtom,
  terminalProfilesAtom,
  isTerminalProfilesOpenAtom,
} from '../../store/atoms'
import type { Host } from '../../types'
import {
  UpdateHost,
  BrowseKeyFile,
  CheckPasswordManagers,
  TestCredentialRef,
} from '../../../wailsjs/go/main/App'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { GenerateKeyModal } from './GenerateKeyModal'
import { DeployKeyModal } from './DeployKeyModal'
import { HostFormTabs, type HostFormData } from './HostFormTabs'
import type { PasswordManagersStatus } from '../../types'

interface FormErrors {
  label?: string
  hostname?: string
  username?: string
}

export function EditHostModal() {
  const [isOpen, setIsOpen] = useAtom(isEditHostOpenAtom)
  const editingHost = useAtomValue(editingHostAtom)
  const setHosts = useSetAtom(hostsAtom)
  const hosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)
  const profiles = useAtomValue(terminalProfilesAtom)
  const setProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)
  const [form, setForm] = useState<HostFormData>({
    id: '',
    label: '',
    hostname: '',
    port: 22,
    username: '',
    authMethod: 'password',
    password: '',
    credentialSource: 'inline',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [browsingKey, setBrowsingKey] = useState(false)
  const [generateKeyOpen, setGenerateKeyOpen] = useState(false)
  const [deployKeyOpen, setDeployKeyOpen] = useState(false)
  const [pmStatus, setPmStatus] = useState<PasswordManagersStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [activeTab, setActiveTab] = useState('connection')

  useEffect(() => {
    if (editingHost) {
      setForm({
        id: editingHost.id,
        label: editingHost.label,
        hostname: editingHost.hostname,
        port: editingHost.port,
        username: editingHost.username,
        authMethod: editingHost.authMethod,
        password: '',
        keyPath: editingHost.keyPath,
        keyPassphrase: '',
        groupId: editingHost.groupId,
        color: editingHost.color,
        tags: editingHost.tags,
        terminalProfileId: editingHost.terminalProfileId,
        jumpHostId: editingHost.jumpHostId,
        credentialSource: editingHost.credentialSource ?? 'inline',
        credentialRef: editingHost.credentialRef ?? '',
      })
      setErrors({})
      setPmStatus(null)
      setActiveTab('connection')
    }
  }, [editingHost])

  useEffect(() => {
    const credSrc = form.credentialSource ?? 'inline'
    if (credSrc === 'inline') {
      setPmStatus(null)
      return
    }
    if (isOpen && form.authMethod === 'password') {
      CheckPasswordManagers()
        .then(setPmStatus)
        .catch(() => {})
    }
  }, [isOpen, form.authMethod, form.credentialSource])

  function close() {
    setIsOpen(false)
    setErrors({})
  }

  function validate(): FormErrors {
    const e: FormErrors = {}
    if (!form.label.trim()) e.label = 'Label is required'
    if (!form.hostname.trim()) e.hostname = 'Hostname is required'
    if (!form.username.trim()) e.username = 'Username is required'
    return e
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      setActiveTab('connection')
      return
    }
    setSubmitting(true)
    try {
      const updated = await UpdateHost({ ...form, id: form.id!, port: Number(form.port) || 22 })
      setHosts((prev) => prev.map((h) => (h.id === updated.id ? (updated as unknown as Host) : h)))
      close()
    } catch (err) {
      toast.error('Failed to update host', { description: String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleTestCredential() {
    setTesting(true)
    try {
      await TestCredentialRef(form.credentialSource ?? 'inline', form.credentialRef ?? '')
      toast.success('Credential fetched successfully')
    } catch (err) {
      toast.error('Credential test failed', { description: String(err) })
    } finally {
      setTesting(false)
    }
  }

  async function handleBrowseKeyFile() {
    setBrowsingKey(true)
    try {
      const path = await BrowseKeyFile()
      if (path) setForm((f) => ({ ...f, keyPath: path }))
    } catch {
      /* user cancelled */
    } finally {
      setBrowsingKey(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit SSH Host</DialogTitle>
          <DialogDescription>Update the details of your SSH host.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form id="eh-form" onSubmit={handleSubmit}>
            <HostFormTabs
              form={form}
              setForm={setForm}
              errors={errors}
              hosts={hosts}
              groups={groups}
              profiles={profiles}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              pmStatus={pmStatus}
              testing={testing}
              browsingKey={browsingKey}
              onTestCredential={handleTestCredential}
              onBrowseKeyFile={handleBrowseKeyFile}
              onOpenGenerateKeyModal={() => setGenerateKeyOpen(true)}
              onOpenDeployKeyModal={() => setDeployKeyOpen(true)}
              onOpenProfilesModal={() => setProfilesOpen(true)}
              onCheckPasswordManagers={() =>
                CheckPasswordManagers()
                  .then(setPmStatus)
                  .catch(() => {})
              }
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="eh-form" disabled={submitting}>
            {submitting && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {submitting ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
      <GenerateKeyModal
        open={generateKeyOpen}
        onClose={() => setGenerateKeyOpen(false)}
        onGenerated={(path) => {
          setForm((f) => ({ ...f, keyPath: path }))
          setGenerateKeyOpen(false)
        }}
      />
      <DeployKeyModal
        open={deployKeyOpen}
        onClose={() => setDeployKeyOpen(false)}
        hostId={form.id ?? ''}
        hostLabel={form.label}
      />
    </Dialog>
  )
}
