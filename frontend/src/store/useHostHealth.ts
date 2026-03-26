import { useCallback, useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { hostHealthAtom } from './atoms'
import { PingHosts } from '../../wailsjs/go/main/HostFacade'
import type { Host } from '../types'

export function useHostHealth(hosts: Host[]) {
  const setHealth = useSetAtom(hostHealthAtom)

  const ping = useCallback(async () => {
    if (hosts.length === 0) return
    const results = await PingHosts(hosts.map((h) => h.id))
    setHealth((prev) => {
      const next = { ...prev }
      for (const r of results) next[r.hostId] = r.latencyMs
      return next
    })
  }, [hosts, setHealth])

  useEffect(() => {
    ping()
    const id = setInterval(ping, 30_000)
    return () => clearInterval(id)
  }, [ping])
}
