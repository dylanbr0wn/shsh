import { useEffect, useCallback, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { keybindingsAtom, activeWorkspaceIdAtom, workspacesAtom } from '../store/atoms'
import { GetKeybindings } from '../../wailsjs/go/main/KeybindFacade'
import { eventToShortcut, normalizeShortcutForMatch } from '../lib/keybind'
import { getActionHandler, type ActionContext } from '../lib/actions'

export function useKeybindings(
  context: Omit<ActionContext, 'activeWorkspaceId' | 'focusedPaneId'>
) {
  const [keybindings, setKeybindings] = useAtom(keybindingsAtom)
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom)
  const workspaces = useAtomValue(workspacesAtom)
  const contextRef = useRef(context)
  useEffect(() => {
    contextRef.current = context
  })

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
        ...contextRef.current,
      })
    },
    [activeWorkspaceId, workspaces]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const refreshKeybindings = useCallback(() => {
    GetKeybindings().then((bindings) => {
      setKeybindings(bindings ?? [])
    })
  }, [setKeybindings])

  return { refreshKeybindings }
}
