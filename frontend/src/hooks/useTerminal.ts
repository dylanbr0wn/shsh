import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useAtomValue } from 'jotai'
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
import { darkTheme, lightTheme } from '../lib/terminalThemes'

export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  sessionId: string,
  isActive: boolean,
  searchAddonRef?: RefObject<SearchAddon | null>
) {
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)

  const settings = useAtomValue(terminalSettingsAtom)
  const { resolvedTheme } = useTheme()

  // Mount once per sessionId
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const theme = resolvedTheme === 'dark' ? darkTheme : lightTheme

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
    if (searchAddonRef) {
      // eslint-disable-next-line react-hooks/immutability -- intentionally writing addon into caller-provided ref
      ;(searchAddonRef as React.MutableRefObject<SearchAddon | null>).current = searchAddon
    }

    // Pipe Go → terminal
    const cancelOutput = EventsOn(`session:output:${sessionId}`, (data: string) => {
      term.write(data)
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
      if (searchAddonRef) {
        ;(searchAddonRef as React.MutableRefObject<SearchAddon | null>).current = null
      }
    }
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    term.options.theme = resolvedTheme === 'dark' ? darkTheme : lightTheme
  }, [resolvedTheme])

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
