import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';
import * as autoReloadModule from '../utils/autoReload';

/**
 * Tests for ErrorBoundary component.
 *
 * Validates error handling behavior:
 * - Renders children normally when no error
 * - Shows error UI when error is thrown
 * - Detects chunk load errors and shows reload prompt
 * - Reset functionality works for recoverable errors
 */

// Component that throws an error for testing
function ThrowError({ error }: { error: Error }): ReactNode {
  throw error;
}

// Suppress React's error boundary console output in tests
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
});

describe('ErrorBoundary', () => {
  describe('normal operation', () => {
    it('should render children when no error', () => {
      render(
        <ErrorBoundary>
          <div>Child content</div>
        </ErrorBoundary>
      );

      expect(screen.getByText('Child content')).toBeInTheDocument();
    });
  });

  describe('regular errors', () => {
    it('should show error UI for regular errors', () => {
      const error = new Error('Test error message');

      render(
        <ErrorBoundary>
          <ThrowError error={error} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Test error message')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('should reset error state when "Try again" is clicked', () => {
      let shouldThrow = true;

      function ConditionalError() {
        if (shouldThrow) {
          throw new Error('Conditional error');
        }
        return <div>Recovered content</div>;
      }

      const { rerender } = render(
        <ErrorBoundary>
          <ConditionalError />
        </ErrorBoundary>
      );

      // Error should be shown
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Fix the error condition
      shouldThrow = false;

      // Click "Try again"
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      // Force re-render to see recovered state
      rerender(
        <ErrorBoundary>
          <ConditionalError />
        </ErrorBoundary>
      );

      // Should show recovered content
      expect(screen.getByText('Recovered content')).toBeInTheDocument();
    });
  });

  describe('chunk load errors', () => {
    it('should show reload UI for dynamic import errors', () => {
      const error = new Error(
        'Failed to fetch dynamically imported module: https://example.com/assets/chunk-abc.js'
      );

      render(
        <ErrorBoundary>
          <ThrowError error={error} />
        </ErrorBoundary>
      );

      expect(screen.getByText('App Update Available')).toBeInTheDocument();
      expect(screen.getByText(/new version.*deployed/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
    });

    it('should show reload UI for MIME type errors', () => {
      const error = new Error(
        'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"'
      );

      render(
        <ErrorBoundary>
          <ThrowError error={error} />
        </ErrorBoundary>
      );

      expect(screen.getByText('App Update Available')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
    });

    it('should call window.location.reload when "Reload Page" is clicked', () => {
      const reloadMock = vi.fn();
      const originalLocation = window.location;

      // Mock window.location.reload
      Object.defineProperty(window, 'location', {
        value: { ...originalLocation, reload: reloadMock },
        writable: true,
      });

      const error = new Error(
        'Failed to fetch dynamically imported module: https://example.com/assets/chunk.js'
      );

      render(
        <ErrorBoundary>
          <ThrowError error={error} />
        </ErrorBoundary>
      );

      fireEvent.click(screen.getByRole('button', { name: /reload page/i }));

      expect(reloadMock).toHaveBeenCalledTimes(1);

      // Restore original
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
      });
    });
  });

  describe('custom fallback', () => {
    it('should use custom fallback when provided', () => {
      const customFallback = (error: Error, reset: () => void) => (
        <div>
          <span>Custom error: {error.message}</span>
          <button onClick={reset}>Custom reset</button>
        </div>
      );

      const error = new Error('Custom test error');

      render(
        <ErrorBoundary fallback={customFallback}>
          <ThrowError error={error} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Custom error: Custom test error')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /custom reset/i })).toBeInTheDocument();
    });
  });

  describe('auto-reload behavior', () => {
    let shouldAutoReloadSpy: ReturnType<typeof vi.spyOn>;
    let autoReloadSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      shouldAutoReloadSpy = vi.spyOn(autoReloadModule, 'shouldAutoReload');
      autoReloadSpy = vi.spyOn(autoReloadModule, 'autoReload').mockImplementation(() => {
        // Mock implementation - don't actually reload
      });
    });

    afterEach(() => {
      shouldAutoReloadSpy.mockRestore();
      autoReloadSpy.mockRestore();
    });

    it('should auto-reload for chunk load errors when cooldown allows', () => {
      shouldAutoReloadSpy.mockReturnValue(true);

      const error = new Error(
        'Failed to fetch dynamically imported module: https://example.com/assets/chunk.js'
      );

      render(
        <ErrorBoundary>
          <ThrowError error={error} />
        </ErrorBoundary>
      );

      expect(shouldAutoReloadSpy).toHaveBeenCalled();
      expect(autoReloadSpy).toHaveBeenCalledTimes(1);
    });

    it('should show reload UI for chunk errors when within cooldown', () => {
      shouldAutoReloadSpy.mockReturnValue(false);

      const error = new Error(
        'Failed to fetch dynamically imported module: https://example.com/assets/chunk.js'
      );

      render(
        <ErrorBoundary>
          <ThrowError error={error} />
        </ErrorBoundary>
      );

      expect(shouldAutoReloadSpy).toHaveBeenCalled();
      expect(autoReloadSpy).not.toHaveBeenCalled();
      // Fallback UI should be shown
      expect(screen.getByText('App Update Available')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
    });

    it('should NOT auto-reload for regular errors', () => {
      shouldAutoReloadSpy.mockReturnValue(true);

      const error = new Error('Regular application error');

      render(
        <ErrorBoundary>
          <ThrowError error={error} />
        </ErrorBoundary>
      );

      // shouldAutoReload should not be called for non-chunk errors
      expect(autoReloadSpy).not.toHaveBeenCalled();
      // Regular error UI should be shown
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });
});
