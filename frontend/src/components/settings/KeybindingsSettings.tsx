import { useState, useEffect, useRef, useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { keybindingsAtom, type ResolvedKeybinding } from '../../store/atoms'
import {
  UpdateKeybinding,
  ResetKeybinding,
  ResetAllKeybindings,
  GetKeybindings,
} from '../../../wailsjs/go/main/KeybindFacade'
import {
  isMac,
  eventToShortcut,
  shortcutParts,
  normalizeShortcutForMatch,
} from '../../lib/keybind'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Kbd, KbdGroup } from '../ui/kbd'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { FieldSet, FieldLegend } from '../ui/field'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '../ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { ButtonGroup } from '../ui/button-group'
import { Dot, RotateCcw, Search } from 'lucide-react'
import { Card } from '../ui/card'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../ui/input-group'

export function KeybindingsSettings() {
  const keybindings = useAtomValue(keybindingsAtom)
  const setKeybindings = useSetAtom(keybindingsAtom)
  const [search, setSearch] = useState('')
  const [recordingActionId, setRecordingActionId] = useState<string | null>(null)
  const [recordedShortcut, setRecordedShortcut] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ResolvedKeybinding | null>(null)
  const recordingRef = useRef<string | null>(null)
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track currently held modifier keys for live display
  const [heldModifiers, setHeldModifiers] = useState<string[]>([])

  recordingRef.current = recordingActionId

  const recordingLabel = recordingActionId
    ? keybindings.find((kb) => kb.action_id === recordingActionId)?.label
    : null

  const refreshBindings = useCallback(async () => {
    const bindings = await GetKeybindings()
    setKeybindings(bindings ?? [])
  }, [setKeybindings])

  const applyBinding = useCallback(
    async (actionId: string, shortcut: string) => {
      try {
        await UpdateKeybinding(actionId, shortcut)
        await refreshBindings()
      } finally {
        setRecordingActionId(null)
        setRecordedShortcut(null)
        setConflict(null)
        setHeldModifiers([])
      }
    },
    [refreshBindings]
  )

  const cancelRecording = useCallback(() => {
    if (applyTimerRef.current) {
      clearTimeout(applyTimerRef.current)
      applyTimerRef.current = null
    }
    setRecordingActionId(null)
    setRecordedShortcut(null)
    setConflict(null)
    setHeldModifiers([])
  }, [])

  // Fetch keybindings on mount (in case useKeybindings hook hasn't run yet)
  useEffect(() => {
    if (keybindings.length === 0) {
      refreshBindings()
    }
  }, [keybindings.length, refreshBindings])

  // Live modifier tracking + recording keydown handler
  useEffect(() => {
    if (!recordingActionId) return

    const updateModifiers = (e: KeyboardEvent) => {
      const mods: string[] = []
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey
      if (cmdOrCtrl) mods.push(isMac ? '⌘' : 'Ctrl')
      if (e.altKey) mods.push(isMac ? '⌥' : 'Alt')
      if (e.shiftKey) mods.push(isMac ? '⇧' : 'Shift')
      setHeldModifiers(mods)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        cancelRecording()
        return
      }

      // Update live modifier display
      updateModifiers(e)

      const shortcut = eventToShortcut(e)
      if (!shortcut) return

      // A non-modifier key was pressed — we have a complete shortcut
      setRecordedShortcut(shortcut)

      const conflicting = keybindings.find(
        (kb) =>
          normalizeShortcutForMatch(kb.shortcut) === shortcut &&
          kb.action_id !== recordingRef.current
      )

      if (conflicting) {
        setConflict(conflicting)
      } else {
        setConflict(null)
        applyTimerRef.current = setTimeout(() => {
          applyTimerRef.current = null
          applyBinding(recordingRef.current!, shortcut)
        }, 300)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      updateModifiers(e)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [recordingActionId, keybindings, applyBinding, cancelRecording])

  async function confirmConflictReassign() {
    if (!conflict || !recordedShortcut || !recordingActionId) return
    await UpdateKeybinding(conflict.action_id, '')
    await applyBinding(recordingActionId, recordedShortcut)
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
      shortcutParts(kb.shortcut).join(' ').toLowerCase().includes(q)
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
      <ButtonGroup className="w-full">
        <ButtonGroup className="flex-1">
          <InputGroup>
            <InputGroupInput
              placeholder="Search shortcuts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <InputGroupAddon>
              <Search size={16} />
            </InputGroupAddon>
          </InputGroup>
        </ButtonGroup>
        <ButtonGroup>
          <Button
            variant="outline"
            disabled={!keybindings.some((kb) => kb.modified)}
            onClick={handleResetAll}
          >
            Reset All to Defaults
          </Button>
        </ButtonGroup>
      </ButtonGroup>

      <ScrollArea className="h-[50vh]">
        <div className="flex flex-col gap-4">
          {sortedCategories.map((category) => (
            <FieldSet key={category} className="p-px">
              <FieldLegend>{category}</FieldLegend>
              <Card size="sm" className="py-0!">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead className="w-1/2">Shortcut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grouped[category].map((kb, i) => (
                      <TableRow key={kb.action_id} className={i % 2 === 0 ? 'bg-muted/30' : ''}>
                        <TableCell className="py-2 font-medium">{kb.label}</TableCell>
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2">
                            <Popover
                              open={recordingActionId === kb.action_id}
                              onOpenChange={(open) => {
                                if (!open) cancelRecording()
                              }}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  className="flex min-w-32 cursor-pointer items-center justify-start gap-1"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setRecordingActionId(kb.action_id)
                                    setRecordedShortcut(null)
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
                                  {kb.modified && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
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
                                          tabIndex={0}
                                        >
                                          <RotateCcw className="size-3" />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent>Reset to default</TooltipContent>
                                    </Tooltip>
                                  )}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                align="end"
                                side="bottom"
                                className="w-72"
                                onOpenAutoFocus={(e) => e.preventDefault()}
                              >
                                <PopoverHeader>
                                  <PopoverTitle>
                                    Recording shortcut for{' '}
                                    <span className="text-primary">{recordingLabel}</span>
                                  </PopoverTitle>
                                  <PopoverDescription>
                                    Press a key combination to assign it.
                                  </PopoverDescription>
                                </PopoverHeader>

                                <div className="bg-muted/50 flex min-h-12 items-center justify-center rounded-md border border-dashed p-3">
                                  {recordedShortcut ? (
                                    <KbdGroup className="text-sm">
                                      {shortcutParts(recordedShortcut).map((part, j) => (
                                        <Kbd key={j} className="h-7 min-w-7 px-1.5">
                                          {part}
                                        </Kbd>
                                      ))}
                                    </KbdGroup>
                                  ) : heldModifiers.length > 0 ? (
                                    <KbdGroup className="text-sm">
                                      {heldModifiers.map((mod, j) => (
                                        <Kbd key={j} className="h-7 min-w-7 px-1.5">
                                          {mod}
                                        </Kbd>
                                      ))}
                                      <span className="text-muted-foreground animate-pulse text-xs">
                                        + key
                                      </span>
                                    </KbdGroup>
                                  ) : (
                                    <span className="text-muted-foreground flex items-center gap-2 text-sm">
                                      <Dot className="size-4 animate-ping" />
                                      Waiting for input…
                                    </span>
                                  )}
                                </div>

                                {conflict && (
                                  <div className="border-destructive/30 bg-destructive/5 flex flex-col gap-2 rounded-md border p-2.5">
                                    <p className="text-destructive text-xs font-medium">
                                      Already bound to &ldquo;{conflict.label}&rdquo;
                                      {conflict.protected && ' (protected)'}
                                    </p>
                                    <div className="flex gap-2">
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        className="h-7 text-xs"
                                        disabled={conflict.protected}
                                        onClick={confirmConflictReassign}
                                      >
                                        Reassign
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs"
                                        onClick={cancelRecording}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                )}

                                <p className="text-muted-foreground text-xs">
                                  Press <Kbd>Esc</Kbd> to cancel, or click outside to close.
                                </p>
                              </PopoverContent>
                            </Popover>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </FieldSet>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
