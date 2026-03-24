import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  isAddHostOpenAtom,
  hostsAtom,
  groupsAtom,
  terminalProfilesAtom,
  isTerminalProfilesOpenAtom,
} from '../../store/atoms'
import type { Host } from '../../types'
import {
  AddHost,
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
import { HostFormTabs, type HostFormData } from './HostFormTabs'
import type { PasswordManagersStatus } from '../../types'

const defaultForm: HostFormData = {
  label: '',
  hostname: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: '',
  jumpHostId: undefined,
  credentialSource: 'inline',
}

interface FormErrors {
  label?: string
  hostname?: string
  username?: string
}

export function AddHostModal() {
  const [isAddHostOpen, setIsAddHostOpen] = useAtom(isAddHostOpenAtom)
  const setHosts = useSetAtom(hostsAtom)
  const hosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)
  const profiles = useAtomValue(terminalProfilesAtom)
  const setProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)
  const [form, setForm] = useState<HostFormData>(defaultForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [browsingKey, setBrowsingKey] = useState(false)
  const [generateKeyOpen, setGenerateKeyOpen] = useState(false)
  const [pmStatus, setPmStatus] = useState<PasswordManagersStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [activeTab, setActiveTab] = useState('connection')

  useEffect(() => {
    const credSrc = form.credentialSource ?? 'inline'
    if (credSrc === 'inline') {
      setPmStatus(null)
      return
    }
    if (isAddHostOpen && form.authMethod === 'password') {
      CheckPasswordManagers()
        .then(setPmStatus)
        .catch(() => {})
    }
  }, [isAddHostOpen, form.authMethod, form.credentialSource])

  function close() {
    setIsAddHostOpen(false)
    setForm(defaultForm)
    setErrors({})
    setPmStatus(null)
    setActiveTab('connection')
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
      // All required fields are on the Connection tab — switch to it
      setActiveTab('connection')
      return
    }
    setSubmitting(true)
    try {
      const host = await AddHost({ ...form, port: Number(form.port) || 22 })
      setHosts((prev) => [...prev, host as unknown as Host])
      close()
    } catch (err) {
      toast.error('Failed to save host', { description: String(err) })
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
    <Dialog open={isAddHostOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add SSH Host</DialogTitle>
          <DialogDescription>
            Save a host you frequently connect to for easy access later.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form id="ah-form" onSubmit={handleSubmit}>
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
              onOpenProfilesModal={() => setProfilesOpen(true)}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="ah-form" disabled={submitting}>
            {submitting && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {submitting ? 'Adding…' : 'Add Host'}
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
    </Dialog>
  )
}
