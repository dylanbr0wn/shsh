import { useEffect, useState } from 'react'
import { Button } from '../ui/button'
import type { SessionStatus } from '../../types'

interface Props {
  status: SessionStatus
  attempt?: number
  maxRetries?: number
  error?: string
  onRetry?: () => void
}

export function ReconnectBanner({ status, attempt, maxRetries, error, onRetry }: Props) {
  const [showSuccess, setShowSuccess] = useState(false)
  const [prevStatus, setPrevStatus] = useState(status)

  useEffect(() => {
    if (prevStatus === 'reconnecting' && status === 'connected') {
      setShowSuccess(true)
      const timer = setTimeout(() => setShowSuccess(false), 2000)
      return () => clearTimeout(timer)
    }
    setPrevStatus(status)
  }, [status, prevStatus])

  if (status === 'reconnecting') {
    const attemptText =
      attempt != null && maxRetries != null ? ` (attempt ${attempt}/${maxRetries})` : ''
    return (
      <div className="absolute right-0 bottom-0 left-0 z-10 bg-amber-500/90 px-4 py-2 text-center text-sm font-medium text-amber-950">
        Connection lost. Reconnecting{attemptText}...
      </div>
    )
  }

  if (status === 'failed') {
    const failedText = error ? `Reconnection failed: ${error}` : 'Reconnection failed'
    return (
      <div className="absolute right-0 bottom-0 left-0 z-10 flex items-center justify-center gap-3 bg-destructive/90 px-4 py-2 text-sm font-medium text-destructive-foreground">
        <span>{failedText}</span>
        {onRetry && (
          <Button variant="secondary" size="sm" className="h-6 px-2 text-xs" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    )
  }

  if (showSuccess) {
    return (
      <div className="absolute right-0 bottom-0 left-0 z-10 bg-green-500/90 px-4 py-2 text-center text-sm font-medium text-green-950 animate-in fade-in">
        Reconnected
      </div>
    )
  }

  return null
}
