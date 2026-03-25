import { useState, useCallback } from 'react'

export function useErrorHandler(): (error: unknown) => void {
  const [, setError] = useState<Error>()

  return useCallback((error: unknown) => {
    setError(() => {
      throw error instanceof Error ? error : new Error(String(error))
    })
  }, [])
}
