import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTheme } from 'next-themes'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { EventsOn, EventsEmit } from '../../wailsjs/runtime/runtime'
import { WriteToSession, ResizeSession } from '../../wailsjs/go/main/App'
import { terminalSettingsAtom } from '../atoms/terminalSettings'
import {
  searchAddonsAtom,
  sessionsAtom,
  hostsAtom,
  groupsAtom,
  terminalProfilesAtom,
  sessionProfileOverridesAtom,
  sessionActivityAtom,
} from '../store/atoms'
import { resolveTheme } from '../lib/terminalThemes'

export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  sessionId: string,
  isActive: boolean
) {
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)

  const globalSettings = useAtomValue(terminalSettingsAtom)
  const sessions = useAtomValue(sessionsAtom)
  const hosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)
  const profiles = useAtomValue(terminalProfilesAtom)
  const sessionOverrides = useAtomValue(sessionProfileOverridesAtom)
  const setSearchAddons = useSetAtom(searchAddonsAtom)
  const setSessionActivity = useSetAtom(sessionActivityAtom)
  const { resolvedTheme } = useTheme()

  // Track isActive in a ref so the output event handler always sees the current value
  const isActiveRef = useRef(isActive)
  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  // Resolve: session override → host profile → group profile → global settings
  const session = sessions.find((s) => s.id === sessionId)
  const host = hosts.find((h) => h.id === session?.hostId)
  const group = groups.find((g) => g.id === host?.groupId)
  const profileId =
    sessionOverrides[sessionId] ?? host?.terminalProfileId ?? group?.terminalProfileId
  const profile = profiles.find((p) => p.id === profileId)
  const settings = profile ?? globalSettings
  const colorTheme = profile?.colorTheme ?? 'auto'

  // Mount once per sessionId
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const theme = resolveTheme(colorTheme, resolvedTheme ?? 'dark')

    const term = new Terminal({
      allowTransparency: true,
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

    // WebGL renderer with canvas fallback
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      term.loadAddon(webglAddon)
    } catch {
      // WebGL unavailable — xterm falls back to canvas renderer
    }

    termRef.current = term
    fitRef.current = fitAddon
    setSearchAddons((prev) => ({ ...prev, [sessionId]: searchAddon }))

    // Pipe Go → terminal
    const cancelOutput = EventsOn(`session:output:${sessionId}`, (data: string) => {
      term.write(data)
      if (!isActiveRef.current) {
        setSessionActivity((prev) => {
          const next = new Set(prev)
          next.add(sessionId)
          return next
        })
      }
    })

    // Pipe terminal → Go
    const onData = term.onData((data: string) => {
      WriteToSession(sessionId, data).catch(() => {})
    })

    // Resize observer
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        ResizeSession(sessionId, term.cols, term.rows).catch(() => {})
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
        delete next[sessionId]
        return next
      })
    }
  }, [
    containerRef,
    resolvedTheme,
    sessionId,
    setSearchAddons,
    setSessionActivity,
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
        ResizeSession(sessionId, term.cols, term.rows).catch(() => {})
      } catch {
        // ignore
      }
      term.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [isActive, sessionId])
}

// Re-export EventsEmit so TerminalInstance doesn't need a separate runtime import
export { EventsEmit }
