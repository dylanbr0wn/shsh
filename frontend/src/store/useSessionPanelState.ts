import { useAtom } from 'jotai'
import { useCallback } from 'react'
import type { PrimitiveAtom } from 'jotai'

export function useSessionPanelState<T>(
  atom: PrimitiveAtom<Record<string, T>>,
  sessionId: string,
  defaultState: T
): [T, (patch: Partial<T>) => void] {
  const [map, setMap] = useAtom(atom)
  const state = map[sessionId] ?? defaultState
  const setState = useCallback(
    (patch: Partial<T>) =>
      setMap((prev) => ({
        ...prev,
        [sessionId]: { ...(prev[sessionId] ?? defaultState), ...patch },
      })),
    [setMap, sessionId, defaultState]
  )
  return [state, setState]
}
