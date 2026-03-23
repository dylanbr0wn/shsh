import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { useAtom, useAtomValue } from 'jotai'
import { isExportHostsOpenAtom, hostsAtom, groupsAtom } from '../../store/atoms'
import type { Host } from '../../types'
import { ExportHosts } from '../../../wailsjs/go/main/App'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { FieldGroup, Field, FieldLabel } from '../ui/field'

type ExportFormat = 'sshconfig' | 'json' | 'csv'
type ExportScope = 'all' | 'group' | 'selected'

export function ExportHostsModal() {
  const [isOpen, setIsOpen] = useAtom(isExportHostsOpenAtom)
  const hosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)

  const [format, setFormat] = useState<ExportFormat>('sshconfig')
  const [scope, setScope] = useState<ExportScope>('all')
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [selectedHostIds, setSelectedHostIds] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  function close() {
    setIsOpen(false)
    setFormat('sshconfig')
    setScope('all')
    setSelectedGroupId('')
    setSelectedHostIds(new Set())
  }

  const exportCount = useMemo(() => {
    if (scope === 'all') return hosts.length
    if (scope === 'group') {
      if (!selectedGroupId) return 0
      return hosts.filter((h) => h.groupId === selectedGroupId).length
    }
    return selectedHostIds.size
  }, [scope, hosts, selectedGroupId, selectedHostIds])

  function toggleHost(id: string) {
    setSelectedHostIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedHostIds.size === hosts.length) {
      setSelectedHostIds(new Set())
    } else {
      setSelectedHostIds(new Set(hosts.map((h) => h.id)))
    }
  }

  async function handleExport() {
    if (exportCount === 0) return
    setExporting(true)
    try {
      const path = await ExportHosts({
        format,
        hostIds: scope === 'selected' ? Array.from(selectedHostIds) : [],
        groupId: scope === 'group' ? selectedGroupId : '',
      })
      if (!path) return // user cancelled the save dialog
      toast.success(`Exported ${exportCount} host${exportCount === 1 ? '' : 's'}`, {
        description: path,
      })
      close()
    } catch (err) {
      toast.error('Export failed', { description: String(err) })
    } finally {
      setExporting(false)
    }
  }

  const allSelected = hosts.length > 0 && selectedHostIds.size === hosts.length
  const someSelected = selectedHostIds.size > 0 && !allSelected

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export Hosts</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel>Format</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                value={format}
                onValueChange={(v) => v && setFormat(v as ExportFormat)}
                className="w-full"
              >
                <ToggleGroupItem value="sshconfig" className="flex-1 text-xs">
                  SSH Config
                </ToggleGroupItem>
                <ToggleGroupItem value="json" className="flex-1 text-xs">
                  JSON
                </ToggleGroupItem>
                <ToggleGroupItem value="csv" className="flex-1 text-xs">
                  CSV
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <Field>
              <FieldLabel>Hosts to export</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                value={scope}
                onValueChange={(v) => v && setScope(v as ExportScope)}
                className="w-full"
              >
                <ToggleGroupItem value="all" className="flex-1 text-xs">
                  All hosts
                </ToggleGroupItem>
                <ToggleGroupItem value="group" className="flex-1 text-xs">
                  By group
                </ToggleGroupItem>
                <ToggleGroupItem value="selected" className="flex-1 text-xs">
                  Selected
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            {scope === 'group' && (
              <Field>
                <FieldLabel>Group</FieldLabel>
                <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a group…" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {scope === 'selected' && (
              <Field>
                <FieldLabel>Select hosts</FieldLabel>
                <div className="border-foreground/15 overflow-hidden rounded-md border">
                  <Table className="table-fixed">
                    <colgroup>
                      <col className="w-10" />
                      <col className="w-2/5" />
                      <col />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <Checkbox
                            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                            onCheckedChange={toggleAll}
                            aria-label="Select all"
                          />
                        </TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead>Host</TableHead>
                      </TableRow>
                    </TableHeader>
                  </Table>
                  <div className="border-foreground/15 h-48 overflow-y-auto border-t">
                    <Table className="table-fixed">
                      <colgroup>
                        <col className="w-10" />
                        <col className="w-2/5" />
                        <col />
                      </colgroup>
                      <TableBody>
                        {hosts.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={3}
                              className="text-muted-foreground py-6 text-center text-sm"
                            >
                              No saved hosts
                            </TableCell>
                          </TableRow>
                        ) : (
                          hosts.map((host: Host) => (
                            <TableRow
                              key={host.id}
                              data-state={selectedHostIds.has(host.id) ? 'selected' : undefined}
                              className="cursor-pointer"
                              onClick={() => toggleHost(host.id)}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={selectedHostIds.has(host.id)}
                                  onCheckedChange={() => toggleHost(host.id)}
                                  aria-label={`Select ${host.label}`}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{host.label}</TableCell>
                              <TableCell className="text-muted-foreground truncate">
                                {host.hostname}:{host.port}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </Field>
            )}
          </FieldGroup>

          <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
            <Badge variant="secondary">{exportCount}</Badge>
            {exportCount === 1 ? 'host' : 'hosts'} will be exported.
            {format !== 'json' && ' Passwords are never exported.'}
          </p>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={exporting || exportCount === 0}>
            {exporting ? 'Exporting…' : 'Export…'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
