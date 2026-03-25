import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'

interface Props {
  fallback: 'inline' | 'panel' | 'fullscreen'
  zone: string
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  resetKeys?: unknown[]
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo)
  }

  componentDidUpdate(prevProps: Props) {
    if (!this.state.hasError || !this.props.resetKeys) return
    const changed = this.props.resetKeys.some((key, i) => key !== prevProps.resetKeys?.[i])
    if (changed) {
      this.setState({ hasError: false, error: null })
    }
  }

  private reset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { fallback, zone } = this.props
    const message = this.state.error?.message ?? 'Unknown error'

    if (fallback === 'fullscreen') {
      return (
        <div className="bg-background text-foreground flex h-screen w-screen flex-col items-center justify-center gap-4">
          <AlertTriangle className="text-destructive size-10" />
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground max-w-md text-center text-sm">{message}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={this.reset}>
              <RefreshCw className="mr-2 size-4" />
              Try Again
            </Button>
            <Button onClick={() => window.location.reload()}>Reload App</Button>
          </div>
        </div>
      )
    }

    if (fallback === 'panel') {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
          <AlertTriangle className="text-destructive size-6" />
          <p className="text-muted-foreground text-center text-sm">Error in {zone}</p>
          <Button variant="outline" size="sm" onClick={this.reset}>
            <RefreshCw className="mr-2 size-3.5" />
            Try Again
          </Button>
        </div>
      )
    }

    // inline
    return (
      <div className="text-destructive/80 flex items-center gap-2 px-3 py-1.5 text-xs">
        <AlertTriangle className="size-3.5 shrink-0" />
        <span className="truncate">Error in {zone}</span>
        <button
          onClick={this.reset}
          className="text-muted-foreground hover:text-foreground ml-auto shrink-0 text-xs underline"
        >
          Retry
        </button>
      </div>
    )
  }
}
