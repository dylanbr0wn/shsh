import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAtom, useAtomValue } from 'jotai'
import { publishBundleAtom, hostsAtom, groupsAtom } from '../../store/atoms'
import type { Host, RegistryStatus } from '../../types'
import { PushBundle, GetRegistries } from '@wailsjs/go/main/RegistryFacade'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { FieldGroup, Field, FieldLabel, FieldSeparator } from '../ui/field'

export function PublishBundleModal() {
  const [state, setState] = useAtom(publishBundleAtom)
  const allHosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)

  // Only show local hosts (not imported from registries)
  const hosts = useMemo(() => allHosts.filter((h) => h.origin === 'local'), [allHosts])

  const [registries, setRegistries] = useState<RegistryStatus[]>([])
  const [registryName, setRegistryName] = useState('')
  const [namespace, setNamespace] = useState('')
  const [bundleName, setBundleName] = useState('')
  const [tag, setTag] = useState('')
  const [selectedHostIds, setSelectedHostIds] = useState<Set<string>>(new Set())
  const [publishing, setPublishing] = useState(false)

  // Load registries and seed selection when modal opens
  useEffect(() => {
    if (!state.open) return
    GetRegistries()
      .then((regs) => setRegistries(regs ?? []))
      .catch(() => setRegistries([]))
    setSelectedHostIds(new Set(state.preSelectedHostIds))
  }, [state.open, state.preSelectedHostIds])

  function close() {
    setState({ open: false, preSelectedHostIds: [] })
    setRegistryName('')
    setNamespace('')
    setBundleName('')
    setTag('')
    setSelectedHostIds(new Set())
    setRegistries([])
  }

  // Group hosts by their groupId for the picker
  const localGroups = useMemo(() => {
    return groups.filter((g) => g.origin === 'local')
  }, [groups])

  const hostsByGroup = useMemo(() => {
    const map = new Map<string | null, Host[]>()
    for (const host of hosts) {
      const key = host.groupId ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(host)
    }
    return map
  }, [hosts])

  function toggleHost(id: string) {
    setSelectedHostIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleGroup(groupId: string | null) {
    const groupHosts = hostsByGroup.get(groupId) ?? []
    setSelectedHostIds((prev) => {
      const allSelected = groupHosts.every((h) => prev.has(h.id))
      const next = new Set(prev)
      for (const h of groupHosts) {
        if (allSelected) next.delete(h.id)
        else next.add(h.id)
      }
      return next
    })
  }

  function toggleAll() {
    setSelectedHostIds((prev) => {
      if (prev.size === hosts.length) return new Set()
      return new Set(hosts.map((h) => h.id))
    })
  }

  function groupCheckState(groupId: string | null): boolean | 'indeterminate' {
    const groupHosts = hostsByGroup.get(groupId) ?? []
    if (groupHosts.length === 0) return false
    const count = groupHosts.filter((h) => selectedHostIds.has(h.id)).length
    if (count === 0) return false
    if (count === groupHosts.length) return true
    return 'indeterminate'
  }

  const allSelected = hosts.length > 0 && selectedHostIds.size === hosts.length
  const someSelected = selectedHostIds.size > 0 && !allSelected

  const canPublish =
    registryName && namespace.trim() && bundleName.trim() && tag.trim() && selectedHostIds.size > 0

  async function handlePublish() {
    if (!canPublish) return
    setPublishing(true)
    try {
      await PushBundle({
        registryName,
        namespace: namespace.trim(),
        name: bundleName.trim(),
        tag: tag.trim(),
        hostIds: Array.from(selectedHostIds),
      })
      toast.success(
        `Published ${selectedHostIds.size} host${selectedHostIds.size === 1 ? '' : 's'} to ${namespace.trim()}/${bundleName.trim()}`
      )
      close()
    } catch (err) {
      toast.error('Failed to publish', { description: String(err) })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish to Registry</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Registry</FieldLabel>
                <Select value={registryName} onValueChange={setRegistryName}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select registry…" />
                  </SelectTrigger>
                  <SelectContent>
                    {registries.map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Namespace</FieldLabel>
                <Input
                  placeholder="e.g. infra"
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Bundle Name</FieldLabel>
                <Input
                  placeholder="e.g. prod-servers"
                  value={bundleName}
                  onChange={(e) => setBundleName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Tag</FieldLabel>
                <Input placeholder="e.g. v1" value={tag} onChange={(e) => setTag(e.target.value)} />
              </Field>
            </div>
          </FieldGroup>

          <FieldSeparator />

          <FieldGroup>
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>Select Hosts</FieldLabel>
                <span className="text-muted-foreground text-xs">
                  {selectedHostIds.size} of {hosts.length} selected
                </span>
              </div>
              <div className="border-foreground/15 overflow-hidden rounded-md border">
                {/* Header with select all */}
                <div className="border-foreground/15 flex items-center gap-2 border-b px-3 py-2">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                  <span className="text-muted-foreground text-xs font-medium">Select all</span>
                </div>
                {/* Scrollable host list */}
                <div className="h-56 overflow-y-auto">
                  {hosts.length === 0 ? (
                    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                      No local hosts
                    </div>
                  ) : (
                    <>
                      {localGroups.map((group) => {
                        const groupHosts = hostsByGroup.get(group.id) ?? []
                        if (groupHosts.length === 0) return null
                        return (
                          <div key={group.id}>
                            <div
                              className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-1.5"
                              onClick={() => toggleGroup(group.id)}
                            >
                              <Checkbox
                                checked={groupCheckState(group.id)}
                                onCheckedChange={() => toggleGroup(group.id)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select all in ${group.name}`}
                              />
                              <span className="text-xs font-semibold">{group.name}</span>
                              <span className="text-muted-foreground text-xs">
                                {groupHosts.length}
                              </span>
                            </div>
                            {groupHosts.map((host) => (
                              <div
                                key={host.id}
                                className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 py-1.5 pr-3 pl-8"
                                onClick={() => toggleHost(host.id)}
                              >
                                <Checkbox
                                  checked={selectedHostIds.has(host.id)}
                                  onCheckedChange={() => toggleHost(host.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={`Select ${host.label}`}
                                />
                                <span className="flex-1 truncate text-xs">{host.label}</span>
                                <span className="text-muted-foreground truncate font-mono text-xs">
                                  {host.hostname}:{host.port}
                                </span>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                      {/* Ungrouped hosts */}
                      {hostsByGroup.get(null) && hostsByGroup.get(null)!.length > 0 && (
                        <div>
                          {localGroups.length > 0 && (
                            <div
                              className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-1.5"
                              onClick={() => toggleGroup(null)}
                            >
                              <Checkbox
                                checked={groupCheckState(null)}
                                onCheckedChange={() => toggleGroup(null)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label="Select all ungrouped"
                              />
                              <span className="text-xs font-semibold">Ungrouped</span>
                              <span className="text-muted-foreground text-xs">
                                {hostsByGroup.get(null)!.length}
                              </span>
                            </div>
                          )}
                          {hostsByGroup.get(null)!.map((host) => (
                            <div
                              key={host.id}
                              className={`hover:bg-muted/50 flex cursor-pointer items-center gap-2 py-1.5 pr-3 ${localGroups.length > 0 ? 'pl-8' : 'pl-3'}`}
                              onClick={() => toggleHost(host.id)}
                            >
                              <Checkbox
                                checked={selectedHostIds.has(host.id)}
                                onCheckedChange={() => toggleHost(host.id)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select ${host.label}`}
                              />
                              <span className="flex-1 truncate text-xs">{host.label}</span>
                              <span className="text-muted-foreground truncate font-mono text-xs">
                                {host.hostname}:{host.port}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Field>
          </FieldGroup>

          <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
            <Badge variant="secondary">{selectedHostIds.size}</Badge>
            {selectedHostIds.size === 1 ? 'host' : 'hosts'} will be published. Credentials are never
            sent.
          </p>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={handlePublish} disabled={publishing || !canPublish}>
            {publishing
              ? 'Publishing…'
              : `Publish ${selectedHostIds.size} host${selectedHostIds.size === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
