import { useState, useEffect, useRef, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { keybindingsAtom, type ResolvedKeybinding } from '../../store/atoms'
import {
  UpdateKeybinding,
  ResetKeybinding,
  ResetAllKeybindings,
  GetKeybindings,
} from '../../../wailsjs/go/main/KeybindFacade'
import { eventToShortcut, formatShortcutForDisplay } from '../../lib/keybind'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Kbd, KbdGroup } from '../ui/kbd'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { FieldSet, FieldLegend } from '../ui/field'
import { getDefaultStore } from 'jotai'
import { ButtonGroup } from '../ui/button-group'
import { Dot, RotateCcw } from 'lucide-react'

const store = getDefaultStore()

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

/** Split a CmdOrCtrl+Shift+K shortcut into display parts for individual Kbd elements */
function shortcutParts(shortcut: string): string[] {
  if (!shortcut) return []
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  const result: string[] = []
  for (const mod of modifiers) {
    switch (mod) {
      case 'CmdOrCtrl':
        result.push(isMac ? '⌘' : 'Ctrl')
        break
      case 'Alt':
        result.push(isMac ? '⌥' : 'Alt')
        break
      case 'Shift':
        result.push(isMac ? '⇧' : 'Shift')
        break
    }
  }
  result.push(key.toUpperCase())
  return result
}

export function KeybindingsSettings() {
  const keybindings = useAtomValue(keybindingsAtom)
  const [search, setSearch] = useState('')
  const [recordingActionId, setRecordingActionId] = useState<string | null>(null)
  const [pendingShortcut, setPendingShortcut] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ResolvedKeybinding | null>(null)
  const recordingRef = useRef<string | null>(null)

  recordingRef.current = recordingActionId

  const refreshBindings = useCallback(async () => {
    const bindings = await GetKeybindings()
    store.set(keybindingsAtom, bindings ?? [])
  }, [])

  const applyBinding = useCallback(
    async (actionId: string, shortcut: string) => {
      try {
        await UpdateKeybinding(actionId, shortcut)
        await refreshBindings()
      } finally {
        setRecordingActionId(null)
        setPendingShortcut(null)
        setConflict(null)
      }
    },
    [refreshBindings]
  )

  // Fetch keybindings on mount (in case useKeybindings hook hasn't run yet)
  useEffect(() => {
    if (keybindings.length === 0) {
      refreshBindings()
    }
  }, [keybindings.length, refreshBindings])

  // Recording keydown handler
  useEffect(() => {
    if (!recordingActionId) return

    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecordingActionId(null)
        setPendingShortcut(null)
        setConflict(null)
        return
      }

      const shortcut = eventToShortcut(e)
      if (!shortcut) return

      const conflicting = keybindings.find(
        (kb) => kb.shortcut === shortcut && kb.action_id !== recordingRef.current
      )

      if (conflicting) {
        setPendingShortcut(shortcut)
        setConflict(conflicting)
      } else {
        applyBinding(recordingRef.current!, shortcut)
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [recordingActionId, keybindings, applyBinding])

  async function confirmConflictReassign() {
    if (!conflict || !pendingShortcut || !recordingActionId) return
    await UpdateKeybinding(conflict.action_id, '')
    await applyBinding(recordingActionId, pendingShortcut)
  }

  async function handleReset(actionId: string) {
    await ResetKeybinding(actionId)
    await refreshBindings()
  }

  async function handleResetAll() {
    await ResetAllKeybindings()
    await refreshBindings()
  }

  const filtered = keybindings.filter((kb) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      kb.label.toLowerCase().includes(q) ||
      kb.shortcut.toLowerCase().includes(q) ||
      formatShortcutForDisplay(kb.shortcut).toLowerCase().includes(q)
    )
  })

  const grouped = filtered.reduce<Record<string, ResolvedKeybinding[]>>((acc, kb) => {
    if (!acc[kb.category]) acc[kb.category] = []
    acc[kb.category].push(kb)
    return acc
  }, {})

  const sortedCategories = Object.keys(grouped).sort()

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search shortcuts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <ScrollArea className="h-[50vh]">
        <div className="flex flex-col gap-4 pr-3">
          {sortedCategories.map((category) => (
            <FieldSet key={category}>
              <FieldLegend>{category}</FieldLegend>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right">Shortcut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped[category].map((kb, i) => (
                    <TableRow key={kb.action_id} className={i % 2 === 0 ? 'bg-muted/30' : ''}>
                      <TableCell className="py-2 font-medium">{kb.label}</TableCell>
                      <TableCell className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {recordingActionId === kb.action_id ? (
                            conflict ? (
                              <ButtonGroup>
                                <span className="text-destructive text-xs">
                                  Conflicts with {conflict.label}.
                                  {conflict.protected && ' (Protected!)'}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-xs"
                                  onClick={confirmConflictReassign}
                                >
                                  Reassign
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-xs"
                                  onClick={() => {
                                    setRecordingActionId(null)
                                    setPendingShortcut(null)
                                    setConflict(null)
                                  }}
                                >
                                  Cancel
                                </Button>
                              </ButtonGroup>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-primary text-primary hover:text-primary"
                              >
                                <Dot className="size-4 animate-ping" />
                                Press shortcut…
                              </Button>
                            )
                          ) : (
                            <Button
                              className="flex min-w-32 cursor-pointer items-center justify-start gap-1"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRecordingActionId(kb.action_id)
                                setPendingShortcut(null)
                                setConflict(null)
                              }}
                            >
                              {kb.shortcut ? (
                                <KbdGroup className="text-xs">
                                  {shortcutParts(kb.shortcut).map((part, j) => (
                                    <Kbd key={j}>{part}</Kbd>
                                  ))}
                                </KbdGroup>
                              ) : (
                                <Kbd>Unbound</Kbd>
                              )}
                              <div className="grow" />
                              {kb.modified && recordingActionId !== kb.action_id && (
                                <div
                                  role="button"
                                  className="focus-visible:ring-primary data-[state=open]:bg-muted justify-self-end rounded p-1 opacity-50 transition-opacity hover:opacity-100 focus:opacity-100 focus-visible:ring"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleReset(kb.action_id)
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault()
                                      handleReset(kb.action_id)
                                    }
                                  }}
                                  title="Reset to default"
                                  tabIndex={0}
                                >
                                  <RotateCcw className="size-3" />
                                </div>
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </FieldSet>
          ))}
        </div>
      </ScrollArea>

      {keybindings.some((kb) => kb.modified) && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={handleResetAll}>
            Reset All to Defaults
          </Button>
        </div>
      )}
    </div>
  )
}
