import type { ReactNode } from 'react';
import React, { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isChunkLoadError } from '../utils/chunkLoadError';
import { shouldAutoReload, autoReload } from '../utils/autoReload';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Auto-reload for chunk load errors (stale deployment)
    if (isChunkLoadError(error)) {
      if (shouldAutoReload()) {
        autoReload();
        return; // Don't report error if we're reloading
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
      });
    } else {
      // Fallback to console for older environments
      console.error('Error caught by boundary:', error, errorInfo);
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback && this.state.error) {
        return this.props.fallback(this.state.error, this.reset);
      }

      // Check if this is a chunk load error (stale deployment)
      if (isChunkLoadError(this.state.error)) {
        return (
          <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 max-w-md w-full">
              <div className="flex items-start gap-3">
                <RefreshCw className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-blue-800 dark:text-blue-200 mb-2">
                    App Update Available
                  </h2>
                  <p className="text-sm text-blue-700 dark:text-blue-300 mb-4">
                    A new version of the app has been deployed. Please reload the page to get the latest updates.
                  </p>
                  <button
                    onClick={this.handleReload}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Reload Page
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      }

      // Default error UI for other errors
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-6 max-w-md w-full">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
                  Something went wrong
                </h2>
                <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                  {this.state.error?.message || 'An unexpected error occurred'}
                </p>
                <button
                  onClick={this.reset}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook for using error boundary programmatically
export function useErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return setError;
}