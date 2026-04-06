import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Spinner } from '../ui/spinner'
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
import { UpdateHost } from '@wailsjs/go/main/HostFacade'
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
import { HostFormTabs } from './HostFormTabs'
import { useHostForm } from './useHostForm'
import type { HostFormData } from './HostFormTabs'

export function EditHostModal() {
  const [isOpen, setIsOpen] = useAtom(isEditHostOpenAtom)
  const editingHost = useAtomValue(editingHostAtom)
  const setHosts = useSetAtom(hostsAtom)
  const hosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)
  const profiles = useAtomValue(terminalProfilesAtom)
  const setProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)
  const [generateKeyOpen, setGenerateKeyOpen] = useState(false)
  const [deployKeyOpen, setDeployKeyOpen] = useState(false)

  const initialData = useMemo<HostFormData | undefined>(() => {
    if (!editingHost) return undefined
    return {
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
    }
  }, [editingHost])

  const hf = useHostForm({ isOpen, initialData })

  function close() {
    setIsOpen(false)
    hf.setErrors({})
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = hf.validate()
    if (Object.keys(errs).length > 0) {
      hf.setErrors(errs)
      hf.setActiveTab('connection')
      return
    }
    hf.setSubmitting(true)
    try {
      const updated = await UpdateHost({
        ...hf.form,
        id: hf.form.id!,
        port: Number(hf.form.port) || 22,
      })
      setHosts((prev) => prev.map((h) => (h.id === updated.id ? (updated as unknown as Host) : h)))
      close()
    } catch (err) {
      toast.error('Failed to update host', { description: String(err) })
    } finally {
      hf.setSubmitting(false)
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
              form={hf.form}
              setForm={hf.setForm}
              errors={hf.errors}
              hosts={hosts}
              groups={groups}
              profiles={profiles}
              activeTab={hf.activeTab}
              onTabChange={hf.setActiveTab}
              pmStatus={hf.pmStatus}
              testing={hf.testing}
              browsingKey={hf.browsingKey}
              onTestCredential={hf.handleTestCredential}
              onBrowseKeyFile={hf.handleBrowseKeyFile}
              onOpenGenerateKeyModal={() => setGenerateKeyOpen(true)}
              onOpenDeployKeyModal={() => setDeployKeyOpen(true)}
              onOpenProfilesModal={() => setProfilesOpen(true)}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="eh-form" disabled={hf.submitting}>
            {hf.submitting && <Spinner data-icon="inline-start" />}
            {hf.submitting ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
      <GenerateKeyModal
        open={generateKeyOpen}
        onClose={() => setGenerateKeyOpen(false)}
        onGenerated={(path) => {
          hf.setForm((f) => ({ ...f, keyPath: path }))
          setGenerateKeyOpen(false)
        }}
      />
      <DeployKeyModal
        open={deployKeyOpen}
        onClose={() => setDeployKeyOpen(false)}
        hostId={hf.form.id ?? ''}
        hostLabel={hf.form.label}
      />
    </Dialog>
  )
}
