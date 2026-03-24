import { useAtom } from 'jotai'
import { useCallback } from 'react'
import type { PrimitiveAtom } from 'jotai'

export function useChannelPanelState<T>(
  atom: PrimitiveAtom<Record<string, T>>,
  channelId: string,
  defaultState: T
): [T, (patch: Partial<T>) => void] {
  const [map, setMap] = useAtom(atom)
  const state = map[channelId] ?? defaultState
  const setState = useCallback(
    (patch: Partial<T>) =>
      setMap((prev) => ({
        ...prev,
        [channelId]: { ...(prev[channelId] ?? defaultState), ...patch },
      })),
    [setMap, channelId, defaultState]
  )
  return [state, setState]
}
