import type { ReactNode, ErrorInfo } from 'react'
import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { isChunkLoadError } from '../utils/chunkLoadError'
import { shouldAutoReload, autoReload } from '../utils/autoReload'

interface Props {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
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
    // Update state so the next render will show the fallback UI
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Auto-reload for chunk load errors (stale deployment)
    if (isChunkLoadError(error)) {
      if (shouldAutoReload()) {
        autoReload()
        return // Don't report error if we're reloading
      }
      // If within cooldown, fall through to show fallback UI
    }

    // React 19 feature: reportError for better error tracking
    if ('reportError' in window && typeof window.reportError === 'function') {
      window.reportError({
        error,
        componentStack: errorInfo.componentStack,
        errorBoundary: true,
        timestamp: new Date().toISOString(),
      })
    } else {
      // Fallback to console for older environments
      console.error('Error caught by boundary:', error, errorInfo)
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  override render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback && this.state.error) {
        return this.props.fallback(this.state.error, this.reset)
      }

      // Check if this is a chunk load error (stale deployment)
      if (isChunkLoadError(this.state.error)) {
        return (
          <div className="flex min-h-[400px] flex-col items-center justify-center p-8">
            <div className="w-full max-w-md rounded-lg bg-blue-50 p-6 dark:bg-blue-900/20">
              <div className="flex items-start gap-3">
                <RefreshCw className="mt-0.5 h-6 w-6 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                <div className="flex-1">
                  <h2 className="mb-2 text-lg font-semibold text-blue-800 dark:text-blue-200">
                    App Update Available
                  </h2>
                  <p className="mb-4 text-sm text-blue-700 dark:text-blue-300">
                    A new version of the app has been deployed. Please reload the page to get the
                    latest updates.
                  </p>
                  <button
                    onClick={this.handleReload}
                    className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Reload Page
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      // Default error UI for other errors
      return (
        <div className="flex min-h-[400px] flex-col items-center justify-center p-8">
          <div className="w-full max-w-md rounded-lg bg-red-50 p-6 dark:bg-red-900/20">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-red-600 dark:text-red-400" />
              <div className="flex-1">
                <h2 className="mb-2 text-lg font-semibold text-red-800 dark:text-red-200">
                  Something went wrong
                </h2>
                <p className="mb-4 text-sm text-red-700 dark:text-red-300">
                  {this.state.error?.message || 'An unexpected error occurred'}
                </p>
                <button
                  onClick={this.reset}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
