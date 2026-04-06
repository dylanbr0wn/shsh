import { useState } from 'react'
import { toast } from 'sonner'
import { Spinner } from '../ui/spinner'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  isAddHostOpenAtom,
  hostsAtom,
  groupsAtom,
  terminalProfilesAtom,
  isTerminalProfilesOpenAtom,
} from '../../store/atoms'
import type { Host } from '../../types'
import { AddHost } from '@wailsjs/go/main/HostFacade'
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
import { HostFormTabs } from './HostFormTabs'
import { useHostForm } from './useHostForm'

export function AddHostModal() {
  const [isAddHostOpen, setIsAddHostOpen] = useAtom(isAddHostOpenAtom)
  const setHosts = useSetAtom(hostsAtom)
  const hosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)
  const profiles = useAtomValue(terminalProfilesAtom)
  const setProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)
  const [generateKeyOpen, setGenerateKeyOpen] = useState(false)

  const hf = useHostForm({ isOpen: isAddHostOpen })

  function close() {
    setIsAddHostOpen(false)
    hf.reset()
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
      const host = await AddHost({ ...hf.form, port: Number(hf.form.port) || 22 })
      setHosts((prev) => [...prev, host as unknown as Host])
      close()
    } catch (err) {
      toast.error('Failed to save host', { description: String(err) })
    } finally {
      hf.setSubmitting(false)
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
              onOpenProfilesModal={() => setProfilesOpen(true)}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="ah-form" disabled={hf.submitting}>
            {hf.submitting && <Spinner data-icon="inline-start" />}
            {hf.submitting ? 'Adding…' : 'Add Host'}
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
    </Dialog>
  )
}
