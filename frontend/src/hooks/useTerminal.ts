import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTheme } from 'next-themes'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { EventsOn, EventsEmit } from '@wailsjs/runtime/runtime'
import { WriteToChannel, ResizeChannel } from '@wailsjs/go/main/SessionFacade'
import { terminalSettingsAtom } from '../atoms/terminalSettings'
import {
  searchAddonsAtom,
  hostsAtom,
  groupsAtom,
  terminalProfilesAtom,
  channelProfileOverridesAtom,
  channelActivityAtom,
} from '../store/atoms'
import { resolveTheme } from '../lib/terminalThemes'

export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  channelId: string,
  hostId: string,
  isActive: boolean
) {
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)

  const globalSettings = useAtomValue(terminalSettingsAtom)
  const hosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)
  const profiles = useAtomValue(terminalProfilesAtom)
  const channelOverrides = useAtomValue(channelProfileOverridesAtom)
  const setSearchAddons = useSetAtom(searchAddonsAtom)
  const setChannelActivity = useSetAtom(channelActivityAtom)
  const { resolvedTheme } = useTheme()

  // Sync ref before paint so the output handler always reads the current value.
  // useLayoutEffect runs synchronously after commit (before paint), eliminating
  // the post-paint async gap that useEffect would leave.
  const isActiveRef = useRef(isActive)
  // Timestamp (ms) of when this channel last became inactive. Used to suppress
  // activity indicators for output that arrives in the brief window right after
  // a tab switch (e.g. shell prompt redraws triggered by the switch itself).
  const becameInactiveAtRef = useRef<number>(0)
  useLayoutEffect(() => {
    if (isActive) {
      becameInactiveAtRef.current = 0
    } else if (isActiveRef.current) {
      // Transitioning active → inactive
      becameInactiveAtRef.current = Date.now()
    }
    isActiveRef.current = isActive
  }, [isActive])

  // Clear activity flag whenever this channel becomes active (handles programmatic
  // activation from useAppInit in addition to user clicks in sidebar)
  useEffect(() => {
    if (!isActive) return
    setChannelActivity((prev) => {
      const next = new Set(prev)
      if (!next.has(channelId)) return prev
      next.delete(channelId)
      return [...next]
    })
  }, [isActive, channelId, setChannelActivity])

  // Resolve: channel override → host profile → group profile → global settings
  const host = hosts.find((h) => h.id === hostId)
  const group = groups.find((g) => g.id === host?.groupId)
  const profileId =
    channelOverrides[channelId] ?? host?.terminalProfileId ?? group?.terminalProfileId
  const profile = profiles.find((p) => p.id === profileId)
  const settings = profile ?? globalSettings
  const colorTheme = profile?.colorTheme ?? 'auto'

  // Mount once per channelId
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const theme = resolveTheme(colorTheme, resolvedTheme ?? 'dark')

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: settings.cursorBlink,
      cursorStyle: settings.cursorStyle,
      fontSize: settings.fontSize,
      fontFamily: '"Geist Mono Variable", "GeistMono Nerd Font", monospace',
      scrollback: settings.scrollback,
      theme,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const unicode11Addon = new Unicode11Addon()
    const searchAddon = new SearchAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.loadAddon(unicode11Addon)
    term.loadAddon(searchAddon)
    term.open(container)
    term.unicode.activeVersion = '11'
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon
    setSearchAddons((prev) => ({ ...prev, [channelId]: searchAddon }))

    // How long (ms) to suppress the activity indicator after a tab becomes
    // inactive. This absorbs prompt redraws / echoes that the server sends
    // immediately in response to the focus/resize triggered by switching tabs.
    const ACTIVITY_GRACE_MS = 150

    // Pipe Go → terminal
    const cancelOutput = EventsOn(`channel:output:${channelId}`, (data: string) => {
      term.write(data)
      if (!isActiveRef.current) {
        const msSinceInactive = becameInactiveAtRef.current
          ? Date.now() - becameInactiveAtRef.current
          : Infinity
        if (msSinceInactive > ACTIVITY_GRACE_MS) {
          setChannelActivity((prev) => {
            const next = new Set(prev)
            next.add(channelId)
            return [...next]
          })
        }
      }
    })

    // Pipe terminal → Go
    const onData = term.onData((data: string) => {
      WriteToChannel(channelId, data).catch(() => {})
    })

    // Resize observer
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        ResizeChannel(channelId, term.cols, term.rows).catch(() => {})
      } catch {
        // container may not be visible yet
      }
    })
    observer.observe(container)

    return () => {
      cancelOutput()
      onData.dispose()
      observer.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      setSearchAddons((prev) => {
        const next = { ...prev }
        delete next[channelId]
        return next
      })
    }
  }, [
    containerRef,
    resolvedTheme,
    channelId,
    setSearchAddons,
    setChannelActivity,
    colorTheme,
    settings.cursorBlink,
    settings.cursorStyle,
    settings.fontSize,
    settings.scrollback,
  ])

  // Apply settings changes at runtime (no remount needed)
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = settings.fontSize
    term.options.cursorStyle = settings.cursorStyle
    term.options.cursorBlink = settings.cursorBlink
    term.options.scrollback = settings.scrollback
    try {
      fitRef.current?.fit()
    } catch {
      /* ignore */
    }
  }, [settings])

  // Apply theme changes at runtime
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = resolveTheme(colorTheme, resolvedTheme ?? 'dark')
  }, [resolvedTheme, colorTheme])

  // Refit + focus when this tab becomes active
  useEffect(() => {
    if (!isActive) return
    const fit = fitRef.current
    const term = termRef.current
    if (!fit || !term) return

    const id = requestAnimationFrame(() => {
      try {
        fit.fit()
        ResizeChannel(channelId, term.cols, term.rows).catch(() => {})
      } catch {
        // ignore
      }
      term.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [isActive, channelId])
}

// Re-export EventsEmit so TerminalInstance doesn't need a separate runtime import
export { EventsEmit }
