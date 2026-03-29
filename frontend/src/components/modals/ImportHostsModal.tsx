import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { AlertTriangle } from 'lucide-react'
import type { Host, ImportCandidate, ImportPreview } from '../../types'
import { isImportHostsOpenAtom, hostsAtom, groupsAtom } from '../../store/atoms'
import { ListSSHConfigHosts, ImportSSHConfigHosts } from '../../../wailsjs/go/main/HostFacade'
import { ParseImportFile, CommitImport } from '../../../wailsjs/go/main/ToolsFacade'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

type ImportSource = 'sshconfig' | 'file'

interface SSHConfigEntry {
  alias: string
  hostname: string
  port: number
  user: string
}

export function ImportHostsModal() {
  const [isOpen, setIsOpen] = useAtom(isImportHostsOpenAtom)
  const setHosts = useSetAtom(hostsAtom)
  const groups = useAtomValue(groupsAtom)

  const [source, setSource] = useState<ImportSource>('sshconfig')

  // SSH Config state (existing)
  const [sshEntries, setSSHEntries] = useState<SSHConfigEntry[]>([])
  const [sshSelected, setSSHSelected] = useState<Set<string>>(new Set())
  const [sshLoading, setSSHLoading] = useState(false)

  // File import state
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [candidates, setCandidates] = useState<ImportCandidate[]>([])
  const [fileSelected, setFileSelected] = useState<Set<number>>(new Set())
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  const [importing, setImporting] = useState(false)

  // Load SSH config when modal opens with sshconfig source
  useEffect(() => {
    if (!isOpen || source !== 'sshconfig') return
    setSSHLoading(true)
    ListSSHConfigHosts()
      .then((result) => {
        const list = (result as SSHConfigEntry[]) ?? []
        setSSHEntries(list)
        setSSHSelected(new Set(list.map((e) => e.alias)))
      })
      .catch((err) => toast.error('Failed to read SSH config', { description: String(err) }))
      .finally(() => setSSHLoading(false))
  }, [isOpen, source])

  function close() {
    setIsOpen(false)
    setSource('sshconfig')
    setSSHEntries([])
    setSSHSelected(new Set())
    setPreview(null)
    setCandidates([])
    setFileSelected(new Set())
    setFileError(null)
  }

  // --- SSH Config handlers ---

  function toggleSSHAll() {
    if (sshSelected.size === sshEntries.length) {
      setSSHSelected(new Set())
    } else {
      setSSHSelected(new Set(sshEntries.map((e) => e.alias)))
    }
  }

  function toggleSSH(alias: string) {
    setSSHSelected((prev) => {
      const next = new Set(prev)
      if (next.has(alias)) next.delete(alias)
      else next.add(alias)
      return next
    })
  }

  async function handleSSHImport() {
    if (sshSelected.size === 0) return
    setImporting(true)
    try {
      const newHosts = (await ImportSSHConfigHosts(Array.from(sshSelected))) as unknown as Host[]
      if (newHosts.length === 0) {
        toast.info('All hosts already exist')
      } else {
        setHosts((prev) => [...prev, ...newHosts])
        toast.success(`Imported ${newHosts.length} host${newHosts.length === 1 ? '' : 's'}`)
      }
      close()
    } catch (err) {
      toast.error('Import failed', { description: String(err) })
    } finally {
      setImporting(false)
    }
  }

  // --- File import handlers ---

  async function handleChooseFile() {
    setFileError(null)
    setFileLoading(true)
    try {
      const result = (await ParseImportFile()) as unknown as ImportPreview
      if (!result.candidates || result.candidates.length === 0) {
        if (result.detectedFormat) {
          setFileError('No hosts found in the selected file.')
        }
        // else: user cancelled the dialog
        setPreview(null)
        setCandidates([])
        setFileSelected(new Set())
        return
      }
      setPreview(result)
      setCandidates(result.candidates)
      // Select all non-duplicates by default
      const selected = new Set<number>()
      result.candidates.forEach((c: ImportCandidate, i: number) => {
        if (!c.isDuplicate) selected.add(i)
      })
      setFileSelected(selected)
    } catch (err) {
      setFileError(String(err))
    } finally {
      setFileLoading(false)
    }
  }

  function toggleFileAll() {
    if (fileSelected.size === candidates.length) {
      setFileSelected(new Set())
    } else {
      setFileSelected(new Set(candidates.map((_, i) => i)))
    }
  }

  function toggleFile(index: number) {
    setFileSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const updateCandidate = useCallback(
    (index: number, field: keyof ImportCandidate, value: string | number) => {
      setCandidates((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], [field]: value }
        return next
      })
    },
    []
  )

  async function handleFileImport() {
    if (fileSelected.size === 0) return
    setImporting(true)
    try {
      const selected = candidates.filter((_, i) => fileSelected.has(i))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await CommitImport({ candidates: selected } as any)) as unknown as Host[]
      setHosts((prev) => {
        // For duplicates that were overwritten, replace in-place; add new ones at end.
        const dupIds = new Set(selected.filter((c) => c.isDuplicate).map((c) => c.duplicateHostId))
        const updated = prev.map((h) => {
          if (dupIds.has(h.id)) {
            const replacement = result.find((r) => r.id === h.id)
            return replacement ?? h
          }
          return h
        })
        const newHosts = result.filter((r) => !dupIds.has(r.id))
        return [...updated, ...newHosts]
      })
      toast.success(`Imported ${result.length} host${result.length === 1 ? '' : 's'}`)
      close()
    } catch (err) {
      toast.error('Import failed', { description: String(err) })
    } finally {
      setImporting(false)
    }
  }

  // Collect new group names from file candidates
  const existingGroupNames = new Set(groups.map((g) => g.name))
  const newGroupNames = [
    ...new Set(
      candidates
        .filter((_, i) => fileSelected.has(i))
        .map((c) => c.groupName)
        .filter((n): n is string => !!n && !existingGroupNames.has(n))
    ),
  ]

  const sshAllSelected = sshEntries.length > 0 && sshSelected.size === sshEntries.length
  const sshSomeSelected = sshSelected.size > 0 && !sshAllSelected
  const fileAllSelected = candidates.length > 0 && fileSelected.size === candidates.length
  const fileSomeSelected = fileSelected.size > 0 && !fileAllSelected

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Hosts</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Source toggle */}
          <ToggleGroup
            type="single"
            variant="outline"
            value={source}
            onValueChange={(v) => v && setSource(v as ImportSource)}
            className="w-full"
          >
            <ToggleGroupItem value="sshconfig" className="flex-1 text-xs">
              SSH Config
            </ToggleGroupItem>
            <ToggleGroupItem value="file" className="flex-1 text-xs">
              From File
            </ToggleGroupItem>
          </ToggleGroup>

          {/* SSH Config path */}
          {source === 'sshconfig' && (
            <>
              {sshLoading ? (
                <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>
              ) : sshEntries.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No hosts found in ~/.ssh/config
                </p>
              ) : (
                <>
                  <div className="border-foreground/15 overflow-hidden rounded-md border">
                    <Table className="table-fixed">
                      <colgroup>
                        <col className="w-10" />
                        <col className="w-1/4" />
                        <col className="w-2/5" />
                        <col />
                      </colgroup>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <Checkbox
                              checked={
                                sshAllSelected ? true : sshSomeSelected ? 'indeterminate' : false
                              }
                              onCheckedChange={toggleSSHAll}
                              aria-label="Select all"
                            />
                          </TableHead>
                          <TableHead>Alias</TableHead>
                          <TableHead>Host</TableHead>
                          <TableHead>User</TableHead>
                        </TableRow>
                      </TableHeader>
                    </Table>
                    <div className="border-foreground/15 h-60 overflow-y-auto border-t">
                      <Table className="table-fixed">
                        <colgroup>
                          <col className="w-10" />
                          <col className="w-1/4" />
                          <col className="w-2/5" />
                          <col />
                        </colgroup>
                        <TableBody>
                          {sshEntries.map((entry) => (
                            <TableRow
                              key={entry.alias}
                              data-state={sshSelected.has(entry.alias) ? 'selected' : undefined}
                              className="cursor-pointer"
                              onClick={() => toggleSSH(entry.alias)}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={sshSelected.has(entry.alias)}
                                  onCheckedChange={() => toggleSSH(entry.alias)}
                                  aria-label={`Select ${entry.alias}`}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{entry.alias}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {entry.hostname}:{entry.port}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{entry.user}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">Duplicate hosts will be skipped.</p>
                </>
              )}
            </>
          )}

          {/* File import path */}
          {source === 'file' && (
            <>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleChooseFile}
                  disabled={fileLoading}
                >
                  {fileLoading ? 'Reading…' : 'Choose File…'}
                </Button>
                <span className="text-muted-foreground text-xs">
                  Supports shsh JSON, shsh CSV, and Termius CSV
                </span>
              </div>

              {fileError && <p className="text-destructive text-sm">{fileError}</p>}

              {candidates.length > 0 && (
                <>
                  <div className="border-foreground/15 overflow-hidden rounded-md border">
                    <Table className="table-fixed">
                      <colgroup>
                        <col className="w-9" />
                        <col className="w-5" />
                        <col />
                        <col />
                        <col className="w-14" />
                        <col />
                        <col className="w-18" />
                        <col />
                      </colgroup>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <Checkbox
                              checked={
                                fileAllSelected ? true : fileSomeSelected ? 'indeterminate' : false
                              }
                              onCheckedChange={toggleFileAll}
                              aria-label="Select all"
                            />
                          </TableHead>
                          <TableHead />
                          <TableHead>Label</TableHead>
                          <TableHead>Hostname</TableHead>
                          <TableHead>Port</TableHead>
                          <TableHead>Username</TableHead>
                          <TableHead>Auth</TableHead>
                          <TableHead>Group</TableHead>
                        </TableRow>
                      </TableHeader>
                    </Table>
                    <div className="border-foreground/15 h-60 overflow-y-auto border-t">
                      <Table className="table-fixed">
                        <colgroup>
                          <col className="w-9" />
                          <col className="w-5" />
                          <col />
                          <col />
                          <col className="w-14" />
                          <col />
                          <col className="w-18" />
                          <col />
                        </colgroup>
                        <TableBody>
                          {candidates.map((c, i) => (
                            <TableRow
                              key={i}
                              data-state={fileSelected.has(i) ? 'selected' : undefined}
                              className="cursor-pointer"
                              onClick={() => toggleFile(i)}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={fileSelected.has(i)}
                                  onCheckedChange={() => toggleFile(i)}
                                  aria-label={`Select ${c.label}`}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </TableCell>
                              <TableCell className="px-0">
                                {c.isDuplicate && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <AlertTriangle className="size-3.5 text-amber-500" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      Host already exists — will overwrite
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={c.label}
                                  onChange={(e) => updateCandidate(i, 'label', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 text-xs"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={c.hostname}
                                  onChange={(e) => updateCandidate(i, 'hostname', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 text-xs"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={c.port}
                                  onChange={(e) =>
                                    updateCandidate(i, 'port', parseInt(e.target.value) || 22)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 text-xs"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={c.username}
                                  onChange={(e) => updateCandidate(i, 'username', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 text-xs"
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={c.authMethod}
                                  onValueChange={(v) => updateCandidate(i, 'authMethod', v)}
                                >
                                  <SelectTrigger
                                    className="h-7 text-xs"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="agent">Agent</SelectItem>
                                    <SelectItem value="password">Password</SelectItem>
                                    <SelectItem value="key">Key</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={c.groupName ?? ''}
                                  onChange={(e) => updateCandidate(i, 'groupName', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 text-xs"
                                  placeholder="None"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <Badge variant="secondary">{fileSelected.size}</Badge>
                    {fileSelected.size === 1 ? 'host' : 'hosts'} selected
                    {preview?.skippedCount
                      ? ` · ${preview.skippedCount} non-SSH entries skipped`
                      : ''}
                    {newGroupNames.length > 0 && (
                      <>
                        {' · '}
                        {newGroupNames.length} new {newGroupNames.length === 1 ? 'group' : 'groups'}{' '}
                        will be created
                      </>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          {source === 'sshconfig' ? (
            <Button
              onClick={handleSSHImport}
              disabled={importing || sshSelected.size === 0 || sshEntries.length === 0}
            >
              {importing ? 'Importing…' : `Import Selected (${sshSelected.size})`}
            </Button>
          ) : (
            <Button
              onClick={handleFileImport}
              disabled={importing || fileSelected.size === 0 || candidates.length === 0}
            >
              {importing ? 'Importing…' : `Import Selected (${fileSelected.size})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
