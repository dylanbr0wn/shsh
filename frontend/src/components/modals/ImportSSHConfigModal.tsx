import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAtom, useSetAtom } from 'jotai'
import type { Host } from '../../types'
import { isImportSSHConfigOpenAtom, hostsAtom } from '../../store/atoms'
import { ListSSHConfigHosts, ImportSSHConfigHosts } from '../../../wailsjs/go/main/App'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { ScrollArea } from '../ui/scroll-area'

interface SSHConfigEntry {
  alias: string
  hostname: string
  port: number
  user: string
}

export function ImportSSHConfigModal() {
  const [isOpen, setIsOpen] = useAtom(isImportSSHConfigOpenAtom)
  const setHosts = useSetAtom(hostsAtom)

  const [entries, setEntries] = useState<SSHConfigEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    ListSSHConfigHosts()
      .then((result) => {
        const list = (result as SSHConfigEntry[]) ?? []
        setEntries(list)
        setSelected(new Set(list.map((e) => e.alias)))
      })
      .catch((err) => toast.error('Failed to read SSH config', { description: String(err) }))
      .finally(() => setLoading(false))
  }, [isOpen])

  function close() {
    setIsOpen(false)
    setEntries([])
    setSelected(new Set())
  }

  function toggleAll() {
    if (selected.size === entries.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(entries.map((e) => e.alias)))
    }
  }

  function toggle(alias: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(alias)) next.delete(alias)
      else next.add(alias)
      return next
    })
  }

  async function handleImport() {
    if (selected.size === 0) return
    setImporting(true)
    try {
      const newHosts = (await ImportSSHConfigHosts(Array.from(selected))) as unknown as Host[]
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

  const allSelected = entries.length > 0 && selected.size === entries.length
  const someSelected = selected.size > 0 && !allSelected

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from SSH Config</DialogTitle>
        </DialogHeader>

        <div className="py-1">
          {loading ? (
            <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No hosts found in ~/.ssh/config
            </p>
          ) : (
            <>
              <ScrollArea className="border-foreground/15 h-72 rounded-md border">
                <Table>
                  <TableHeader className="bg-background sticky top-0 z-10">
                    <TableRow>
                      <TableHead>
                        <Checkbox
                          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                          onCheckedChange={toggleAll}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead>Alias</TableHead>
                      <TableHead>Host</TableHead>
                      <TableHead>User</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow
                        key={entry.alias}
                        data-state={selected.has(entry.alias) ? 'selected' : undefined}
                        className="cursor-pointer"
                        onClick={() => toggle(entry.alias)}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected.has(entry.alias)}
                            onCheckedChange={() => toggle(entry.alias)}
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
              </ScrollArea>
              <p className="text-muted-foreground mt-2 text-xs">Duplicate hosts will be skipped.</p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={importing || selected.size === 0 || entries.length === 0}
          >
            {importing ? 'Importing…' : `Import Selected (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
