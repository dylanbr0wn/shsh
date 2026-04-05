import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PaneToolbar } from './PaneToolbar'
import { TooltipProvider } from '../ui/tooltip'

// jsdom does not implement ResizeObserver — stub it out
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

function renderToolbar(props: Partial<React.ComponentProps<typeof PaneToolbar>> = {}) {
  const defaults: React.ComponentProps<typeof PaneToolbar> = {
    connectionId: 'conn-1',
    channelId: 'chan-1',
    hostId: 'host-1',
    kind: 'terminal',
    loggingActive: false,
    onToggleLogging: vi.fn(),
  }
  return render(
    <TooltipProvider>
      <PaneToolbar {...defaults} {...props} />
    </TooltipProvider>
  )
}

describe('PaneToolbar', () => {
  it('renders all features for terminal panes', () => {
    renderToolbar({ kind: 'terminal' })
    expect(screen.getByLabelText('Terminal settings')).toBeInTheDocument()
    expect(screen.getByLabelText('Port forwards')).toBeInTheDocument()
    expect(screen.getByLabelText('Start logging')).toBeInTheDocument()
  })

  it('renders only port forwards for SFTP panes', () => {
    renderToolbar({ kind: 'sftp' })
    expect(screen.queryByLabelText('Terminal settings')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Port forwards')).toBeInTheDocument()
    expect(screen.queryByLabelText('Start logging')).not.toBeInTheDocument()
  })

  it('renders nothing for local panes', () => {
    const { container } = renderToolbar({ kind: 'local' })
    expect(container.firstChild).toBeNull()
  })

  it('shows stop logging label when logging is active', () => {
    renderToolbar({ kind: 'terminal', loggingActive: true, logPath: '/tmp/log.txt' })
    expect(screen.getByLabelText('Stop logging')).toBeInTheDocument()
  })

  it('calls onToggleLogging when logging button is clicked', async () => {
    const onToggle = vi.fn()
    renderToolbar({ kind: 'terminal', onToggleLogging: onToggle })
    const btn = screen.getByLabelText('Start logging')
    await userEvent.click(btn)
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
