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
import { FieldSet, FieldLegend, FieldGroup } from '../ui/field'
import { getDefaultStore } from 'jotai'

const store = getDefaultStore()

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
  }, [recordingActionId, keybindings])

  async function applyBinding(actionId: string, shortcut: string) {
    try {
      await UpdateKeybinding(actionId, shortcut)
      await refreshBindings()
    } finally {
      setRecordingActionId(null)
      setPendingShortcut(null)
      setConflict(null)
    }
  }

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
    return kb.label.toLowerCase().includes(q) || kb.shortcut.toLowerCase().includes(q)
  })

  const grouped = filtered.reduce<Record<string, ResolvedKeybinding[]>>((acc, kb) => {
    if (!acc[kb.category]) acc[kb.category] = []
    acc[kb.category].push(kb)
    return acc
  }, {})

  const sortedCategories = Object.keys(grouped).sort()

  return (
    <div className="flex flex-col gap-4">
      <Input
        placeholder="Search shortcuts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {sortedCategories.map((category) => (
        <FieldSet key={category}>
          <FieldLegend>{category}</FieldLegend>
          <FieldGroup>
            {grouped[category].map((kb) => (
              <div key={kb.action_id} className="flex items-center justify-between py-1.5">
                <span className="text-sm">{kb.label}</span>
                <div className="flex items-center gap-2">
                  {recordingActionId === kb.action_id ? (
                    conflict ? (
                      <div className="flex items-center gap-2">
                        <span className="text-destructive text-xs">
                          Already bound to {conflict.label}.{conflict.protected && ' (Protected!)'}{' '}
                          Reassign?
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={confirmConflictReassign}
                        >
                          Yes
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
                      <span className="border-primary text-primary animate-pulse rounded border px-2 py-0.5 text-xs">
                        Press shortcut...
                      </span>
                    )
                  ) : (
                    <button
                      className="border-border bg-muted text-muted-foreground hover:border-primary hover:text-primary rounded border px-2 py-0.5 font-mono text-xs transition-colors"
                      onClick={() => {
                        setRecordingActionId(kb.action_id)
                        setPendingShortcut(null)
                        setConflict(null)
                      }}
                    >
                      {formatShortcutForDisplay(kb.shortcut)}
                    </button>
                  )}
                  {kb.modified && recordingActionId !== kb.action_id && (
                    <button
                      className="text-muted-foreground hover:text-foreground text-xs"
                      onClick={() => handleReset(kb.action_id)}
                      title="Reset to default"
                    >
                      ↺
                    </button>
                  )}
                </div>
              </div>
            ))}
          </FieldGroup>
        </FieldSet>
      ))}

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
