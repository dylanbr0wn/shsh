import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { BrowseKeyFile } from '@wailsjs/go/main/KeysFacade'
import { CheckPasswordManagers, TestCredentialRef } from '@wailsjs/go/main/ToolsFacade'
import type { HostFormData } from './HostFormTabs'
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

export interface FormErrors {
  label?: string
  hostname?: string
  username?: string
}

interface UseHostFormOptions {
  isOpen: boolean
  initialData?: HostFormData
}

export function useHostForm({ isOpen, initialData }: UseHostFormOptions) {
  const [form, setForm] = useState<HostFormData>(initialData ?? defaultForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [browsingKey, setBrowsingKey] = useState(false)
  const [pmStatus, setPmStatus] = useState<PasswordManagersStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [activeTab, setActiveTab] = useState('connection')

  // Sync form when initialData changes (e.g. editing a different host)
  useEffect(() => {
    if (initialData) {
      setForm(initialData)
      setErrors({})
      setPmStatus(null)
      setActiveTab('connection')
    }
  }, [initialData])

  // Check password manager availability when relevant
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

  function validate(): FormErrors {
    const e: FormErrors = {}
    if (!form.label.trim()) e.label = 'Label is required'
    if (!form.hostname.trim()) e.hostname = 'Hostname is required'
    if (!form.username.trim()) e.username = 'Username is required'
    return e
  }

  const handleTestCredential = useCallback(async () => {
    setTesting(true)
    try {
      await TestCredentialRef(form.credentialSource ?? 'inline', form.credentialRef ?? '')
      toast.success('Credential fetched successfully')
    } catch (err) {
      toast.error('Credential test failed', { description: String(err) })
    } finally {
      setTesting(false)
    }
  }, [form.credentialSource, form.credentialRef])

  const handleBrowseKeyFile = useCallback(async () => {
    setBrowsingKey(true)
    try {
      const path = await BrowseKeyFile()
      if (path) setForm((f) => ({ ...f, keyPath: path }))
    } catch {
      /* user cancelled */
    } finally {
      setBrowsingKey(false)
    }
  }, [])

  function reset() {
    setForm(defaultForm)
    setErrors({})
    setPmStatus(null)
    setActiveTab('connection')
  }

  return {
    form,
    setForm,
    errors,
    setErrors,
    submitting,
    setSubmitting,
    browsingKey,
    pmStatus,
    testing,
    activeTab,
    setActiveTab,
    validate,
    handleTestCredential,
    handleBrowseKeyFile,
    reset,
  }
}
