import { useEffect, useLayoutEffect, useRef } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import type { WailsEventMap } from '../events/topics'

export function useWailsEvent<T extends keyof WailsEventMap>(
  event: T,
  callback: WailsEventMap[T] extends void ? () => void : (payload: WailsEventMap[T]) => void
): void
export function useWailsEvent(event: string, callback: (...args: unknown[]) => void): void
export function useWailsEvent(event: string, callback: (...args: unknown[]) => void) {
  const cbRef = useRef(callback)
  useLayoutEffect(() => {
    cbRef.current = callback
  })

  useEffect(() => {
    const cancel = EventsOn(event, (...args: unknown[]) => cbRef.current(...args))
    return () => cancel()
  }, [event])
}
