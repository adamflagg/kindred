// Global type definitions

interface Window {
  // React 19 error reporting
  reportError?: (error: {
    error: Error;
    componentStack?: string;
    errorBoundary?: boolean;
    timestamp?: string;
    [key: string]: unknown;
  }) => void;
}