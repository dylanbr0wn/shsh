import { useEffect, useLayoutEffect, useRef } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'

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
