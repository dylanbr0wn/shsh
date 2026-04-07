import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  GetRegistries,
  AddRegistry,
  RemoveRegistry,
  SubscribeBundle,
  UnsubscribeBundle,
  SyncBundle,
  SyncAllBundles,
} from '@wailsjs/go/main/RegistryFacade'
import { ListHosts, ListGroups } from '@wailsjs/go/main/HostFacade'
import { useSetAtom } from 'jotai'
import { hostsAtom, groupsAtom } from '../../store/atoms'
import type { RegistryStatus, Host, Group } from '../../types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '../ui/field'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from '../ui/card'
import { RefreshCw, Trash2, Plus, Package } from 'lucide-react'
import { ScrollArea } from '../ui/scroll-area'

export function RegistriesSettings() {
  const [registries, setRegistries] = useState<RegistryStatus[]>([])
  const [loading, setLoading] = useState(true)

  // Form state for adding a new registry
  const [newName, setNewName] = useState('')
  const [newURL, setNewURL] = useState('')
  const [newAPIKey, setNewAPIKey] = useState('')
  const [adding, setAdding] = useState(false)

  // Form state for subscribing to a bundle
  const [subRegistry, setSubRegistry] = useState('')
  const [subBundle, setSubBundle] = useState('')

  // Confirm delete
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const setHosts = useSetAtom(hostsAtom)
  const setGroups = useSetAtom(groupsAtom)

  async function refresh() {
    try {
      const regs = await GetRegistries()
      setRegistries(regs ?? [])
    } catch (err) {
      toast.error('Failed to load registries', { description: String(err) })
    } finally {
      setLoading(false)
    }
  }

  async function refreshHostsAndGroups() {
    try {
      const [hosts, groups] = await Promise.all([ListHosts(), ListGroups()])
      setHosts(hosts as unknown as Host[])
      setGroups(groups as unknown as Group[])
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleAdd() {
    if (!newName.trim() || !newURL.trim() || !newAPIKey.trim()) return
    setAdding(true)
    try {
      await AddRegistry({ name: newName.trim(), url: newURL.trim(), apiKey: newAPIKey.trim() })
      setNewName('')
      setNewURL('')
      setNewAPIKey('')
      toast.success(`Registry "${newName.trim()}" added`)
      await refresh()
    } catch (err) {
      toast.error('Failed to add registry', { description: String(err) })
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(name: string) {
    try {
      await RemoveRegistry(name)
      toast.success(`Registry "${name}" removed`)
      setDeleteTarget(null)
      await Promise.all([refresh(), refreshHostsAndGroups()])
    } catch (err) {
      toast.error('Failed to remove registry', { description: String(err) })
    }
  }

  async function handleSubscribe(registryName: string) {
    if (!subBundle.trim()) return
    try {
      await SubscribeBundle({ registryName, bundle: subBundle.trim() })
      setSubBundle('')
      setSubRegistry('')
      toast.success(`Subscribed to ${subBundle.trim()}`)
      await Promise.all([refresh(), refreshHostsAndGroups()])
    } catch (err) {
      toast.error('Failed to subscribe', { description: String(err) })
    }
  }

  async function handleUnsubscribe(registryName: string, bundle: string) {
    try {
      await UnsubscribeBundle({ registryName, bundle })
      toast.success(`Unsubscribed from ${bundle}`)
      await Promise.all([refresh(), refreshHostsAndGroups()])
    } catch (err) {
      toast.error('Failed to unsubscribe', { description: String(err) })
    }
  }

  async function handleSync(registryName: string, bundle: string) {
    try {
      await SyncBundle(registryName, bundle)
      toast.success(`Synced ${bundle}`)
      await refreshHostsAndGroups()
    } catch (err) {
      toast.error('Failed to sync', { description: String(err) })
    }
  }

  async function handleSyncAll() {
    try {
      await SyncAllBundles()
      toast.success('All bundles synced')
      await refreshHostsAndGroups()
    } catch (err) {
      toast.error('Failed to sync', { description: String(err) })
    }
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading...</p>
  }

  return (
    <ScrollArea className="flex h-full flex-col gap-1">
      <FieldGroup className="pr-3">
        {/* Existing registries */}
        {registries.length > 0 && (
          <FieldSet>
            <div className="flex items-center justify-between">
              <FieldLegend>Connected Registries</FieldLegend>
              <Button variant="outline" size="sm" onClick={handleSyncAll}>
                <RefreshCw data-icon="inline-start" className="size-3.5" />
                Sync All
              </Button>
            </div>
            <div className="flex flex-col gap-3 pl-1">
              {registries.map((reg) => (
                <Card key={reg.name} size="sm">
                  <CardHeader>
                    <div>
                      <CardTitle>{reg.name}</CardTitle>
                      <CardDescription>{reg.url}</CardDescription>
                    </div>
                    <CardAction>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setDeleteTarget(reg.name)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {reg.bundles.map((bundle) => (
                      <div key={bundle} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Package className="text-muted-foreground size-3" />
                          <span className="font-mono text-xs">{bundle}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleSync(reg.name, bundle)}
                          >
                            <RefreshCw className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleUnsubscribe(reg.name, bundle)}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {subRegistry === reg.name ? (
                      <div className="flex gap-1">
                        <Input
                          className="h-7 font-mono text-xs"
                          placeholder="namespace/bundle-name"
                          value={subBundle}
                          onChange={(e) => setSubBundle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSubscribe(reg.name)
                            if (e.key === 'Escape') {
                              setSubRegistry('')
                              setSubBundle('')
                            }
                          }}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSubscribe(reg.name)}
                        >
                          Pull
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-1"
                        onClick={() => setSubRegistry(reg.name)}
                      >
                        <Plus data-icon="inline-start" className="size-3" />
                        Subscribe to bundle
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </FieldSet>
        )}

        {registries.length > 0 && <FieldSeparator />}

        {/* Add new registry */}
        <FieldSet>
          <FieldLegend>Add Registry</FieldLegend>
          <FieldGroup>
            <Field>
              <FieldLabel>Name</FieldLabel>
              <FieldDescription>A display name for this registry connection.</FieldDescription>
              <Input
                placeholder="e.g. Company"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>URL</FieldLabel>
              <FieldDescription>The registry server address.</FieldDescription>
              <Input
                placeholder="https://registry.internal:8080"
                value={newURL}
                onChange={(e) => setNewURL(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>API Key</FieldLabel>
              <FieldDescription>The namespace API key from the registry server.</FieldDescription>
              <Input
                type="password"
                placeholder="shsh_..."
                value={newAPIKey}
                onChange={(e) => setNewAPIKey(e.target.value)}
              />
            </Field>
            <Button
              onClick={handleAdd}
              disabled={adding || !newName.trim() || !newURL.trim() || !newAPIKey.trim()}
            >
              <Plus data-icon="inline-start" />
              {adding ? 'Adding...' : 'Add Registry'}
            </Button>
          </FieldGroup>
        </FieldSet>
      </FieldGroup>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Registry</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the registry connection and delete all synced hosts from &quot;
              {deleteTarget}&quot;. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && handleRemove(deleteTarget)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollArea>
  )
}
