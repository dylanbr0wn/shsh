import { useEffect, useCallback, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { keybindingsAtom, activeWorkspaceIdAtom, workspacesAtom } from '../store/atoms'
import { GetKeybindings } from '../../wailsjs/go/main/KeybindFacade'
import { eventToShortcut, normalizeShortcutForMatch } from '../lib/keybind'
import { getActionHandler, type ActionContext } from '../lib/actions'

type WorkspaceCallbacks = Omit<ActionContext, 'activeWorkspaceId' | 'focusedPaneId'>

let _wsCallbacks: WorkspaceCallbacks = {}

/** Called by WorkspaceView to register workspace-specific action callbacks. */
export function setWorkspaceCallbacks(cb: WorkspaceCallbacks) {
  _wsCallbacks = cb
}

/**
 * Registers global keydown handler for all keybindings.
 * Call once in App (always-mounted). Workspace-specific callbacks
 * are provided via setWorkspaceCallbacks.
 */
export function useKeybindings() {
  const [keybindings, setKeybindings] = useAtom(keybindingsAtom)
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom)
  const workspaces = useAtomValue(workspacesAtom)

  const lookupRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const map = new Map<string, string>()
    for (const kb of keybindings) {
      if (kb.shortcut) {
        map.set(normalizeShortcutForMatch(kb.shortcut), kb.action_id)
      }
    }
    lookupRef.current = map
  }, [keybindings])

  useEffect(() => {
    GetKeybindings().then((bindings) => {
      setKeybindings(bindings ?? [])
    })
  }, [setKeybindings])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const shortcut = eventToShortcut(e)
      if (!shortcut) return

      const actionID = lookupRef.current.get(shortcut)
      if (!actionID) return

      const handler = getActionHandler(actionID)
      if (!handler) return

      e.preventDefault()

      const ws = workspaces.find((w) => w.id === activeWorkspaceId)
      handler({
        activeWorkspaceId,
        focusedPaneId: ws?.focusedPaneId ?? null,
        ..._wsCallbacks,
      })
    },
    [activeWorkspaceId, workspaces]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])
}
