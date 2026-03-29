import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventsOn } from '@wailsjs/runtime/runtime'
import { useWailsEvent } from './useWailsEvent'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useWailsEvent', () => {
  it('subscribes to the event on mount', () => {
    renderHook(() => useWailsEvent('test:event', vi.fn()))

    expect(EventsOn).toHaveBeenCalledTimes(1)
    expect(EventsOn).toHaveBeenCalledWith('test:event', expect.any(Function))
  })

  it('calls the cancel function on unmount', () => {
    const cancel = vi.fn()
    vi.mocked(EventsOn).mockReturnValue(cancel)

    const { unmount } = renderHook(() => useWailsEvent('test:event', vi.fn()))

    expect(cancel).not.toHaveBeenCalled()
    unmount()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('forwards event args to the current callback via ref', () => {
    let internalHandler: (...args: unknown[]) => void = () => {}
    vi.mocked(EventsOn).mockImplementation(
      (_event: string, handler: (...args: unknown[]) => void) => {
        internalHandler = handler
        return vi.fn()
      }
    )

    const callback = vi.fn()
    renderHook(() => useWailsEvent('test:event', callback))

    internalHandler('arg1', 42, { nested: true })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith('arg1', 42, { nested: true })
  })

  it('does not re-subscribe when callback changes', () => {
    let internalHandler: (...args: unknown[]) => void = () => {}
    vi.mocked(EventsOn).mockImplementation(
      (_event: string, handler: (...args: unknown[]) => void) => {
        internalHandler = handler
        return vi.fn()
      }
    )

    const callback1 = vi.fn()
    const callback2 = vi.fn()

    const { rerender } = renderHook(
      ({ cb }: { cb: (...args: unknown[]) => void }) => useWailsEvent('test:event', cb),
      { initialProps: { cb: callback1 } }
    )

    expect(EventsOn).toHaveBeenCalledTimes(1)

    rerender({ cb: callback2 })

    // Still only one subscription
    expect(EventsOn).toHaveBeenCalledTimes(1)

    // Internal handler now routes to the new callback
    internalHandler('payload')
    expect(callback1).not.toHaveBeenCalled()
    expect(callback2).toHaveBeenCalledTimes(1)
    expect(callback2).toHaveBeenCalledWith('payload')
  })

  it('re-subscribes when the event name changes', () => {
    const cancel1 = vi.fn()
    const cancel2 = vi.fn()
    vi.mocked(EventsOn).mockReturnValueOnce(cancel1).mockReturnValueOnce(cancel2)

    const { rerender } = renderHook(
      ({ event }: { event: string }) => useWailsEvent(event, vi.fn()),
      { initialProps: { event: 'event:one' } }
    )

    expect(EventsOn).toHaveBeenCalledTimes(1)
    expect(EventsOn).toHaveBeenCalledWith('event:one', expect.any(Function))

    rerender({ event: 'event:two' })

    // Old subscription torn down
    expect(cancel1).toHaveBeenCalledTimes(1)
    // New subscription created
    expect(EventsOn).toHaveBeenCalledTimes(2)
    expect(EventsOn).toHaveBeenCalledWith('event:two', expect.any(Function))
  })
})
