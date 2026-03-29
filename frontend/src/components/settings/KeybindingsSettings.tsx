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
import { Item, ItemGroup, ItemContent, ItemTitle, ItemActions } from '../ui/item'
import { FieldSet, FieldLegend } from '../ui/field'
import { getDefaultStore } from 'jotai'

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
              <ItemGroup>
                {grouped[category].map((kb) => (
                  <Item key={kb.action_id} variant="muted" size="sm">
                    <ItemContent>
                      <ItemTitle>{kb.label}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      {recordingActionId === kb.action_id ? (
                        conflict ? (
                          <div className="flex items-center gap-2">
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
                          </div>
                        ) : (
                          <Kbd className="border-primary text-primary h-7 animate-pulse border px-2.5 text-xs">
                            Press shortcut…
                          </Kbd>
                        )
                      ) : (
                        <button
                          className="cursor-pointer"
                          onClick={() => {
                            setRecordingActionId(kb.action_id)
                            setPendingShortcut(null)
                            setConflict(null)
                          }}
                        >
                          {kb.shortcut ? (
                            <KbdGroup>
                              {shortcutParts(kb.shortcut).map((part, i) => (
                                <Kbd key={i} className="h-7 min-w-7 px-1.5 text-xs">
                                  {part}
                                </Kbd>
                              ))}
                            </KbdGroup>
                          ) : (
                            <Kbd className="text-muted-foreground h-7 px-2.5 text-xs">Unbound</Kbd>
                          )}
                        </button>
                      )}
                      {kb.modified && recordingActionId !== kb.action_id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-foreground h-6 w-6 p-0 text-xs"
                          onClick={() => handleReset(kb.action_id)}
                          title="Reset to default"
                        >
                          ↺
                        </Button>
                      )}
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
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
