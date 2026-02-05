/**
 * Tests for MetricsSessionContext - URL-based session state for metrics module
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MetricsSessionProvider } from './MetricsSessionContext'
import { useMetricsSession } from '../hooks/useMetricsSession'
import { CurrentYearContext, type CurrentYearContextType } from '../hooks/useCurrentYear'

// Mock useMetricsSessions hook
vi.mock('../hooks/useMetricsSessions', () => ({
  useMetricsSessions: vi.fn(() => ({
    data: [
      {
        cm_id: 1001,
        name: 'Session 1',
        session_type: 'main',
        start_date: '2026-06-15',
      },
      {
        cm_id: 1002,
        name: 'Session 2',
        session_type: 'main',
        start_date: '2026-07-01',
      },
      {
        cm_id: 1003,
        name: 'Session 2a',
        session_type: 'embedded',
        start_date: '2026-07-01',
      },
    ],
    isLoading: false,
  })),
}))

// Test component that displays context values
function TestConsumer() {
  const { selectedSessionCmId, selectedSession, sessions, isLoading } = useMetricsSession()
  return (
    <div>
      <span data-testid="selectedSessionCmId">
        {selectedSessionCmId === null ? 'null' : selectedSessionCmId}
      </span>
      <span data-testid="selectedSessionName">{selectedSession?.name ?? 'All Sessions'}</span>
      <span data-testid="sessionsCount">{sessions.length}</span>
      <span data-testid="isLoading">{isLoading ? 'true' : 'false'}</span>
    </div>
  )
}

// Test component that sets session via context
function TestSetter({ sessionCmId }: { sessionCmId: number | null }) {
  const { setSelectedSessionCmId } = useMetricsSession()
  return (
    <button onClick={() => setSelectedSessionCmId(sessionCmId)} data-testid="set-session">
      Set Session
    </button>
  )
}

// Test component that clears session
function TestClearer() {
  const { clearSession } = useMetricsSession()
  return (
    <button onClick={clearSession} data-testid="clear-session">
      Clear
    </button>
  )
}

// Test component that displays URL params
function UrlParamViewer() {
  const [searchParams] = useSearchParams()
  return <span data-testid="url-session">{searchParams.get('session') ?? 'none'}</span>
}

// Helper to create test wrapper
function createWrapper(initialPath: string = '/metrics/registration') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const mockYearContext: CurrentYearContextType = {
    currentYear: 2026,
    setCurrentYear: vi.fn(),
    availableYears: [2026, 2025, 2024, 2023, 2022],
    isTransitioning: false,
  }

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <CurrentYearContext.Provider value={mockYearContext}>
            <MetricsSessionProvider>{children}</MetricsSessionProvider>
          </CurrentYearContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('MetricsSessionContext', () => {
  describe('initial state', () => {
    it('should default to null (all sessions) when no URL param', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/metrics/registration'),
      })

      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('null')
      expect(screen.getByTestId('selectedSessionName')).toHaveTextContent('All Sessions')
    })

    it('should read session from URL param on init', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/metrics/registration?session=1001'),
      })

      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('1001')
      expect(screen.getByTestId('selectedSessionName')).toHaveTextContent('Session 1')
    })

    it('should provide sessions from useMetricsSessions', () => {
      render(<TestConsumer />, { wrapper: createWrapper() })

      expect(screen.getByTestId('sessionsCount')).toHaveTextContent('3')
    })
  })

  describe('setSelectedSessionCmId', () => {
    it('should update selectedSessionCmId when called', async () => {
      render(
        <>
          <TestConsumer />
          <TestSetter sessionCmId={1002} />
        </>,
        { wrapper: createWrapper() }
      )

      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('null')

      await act(async () => {
        screen.getByTestId('set-session').click()
      })

      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('1002')
      expect(screen.getByTestId('selectedSessionName')).toHaveTextContent('Session 2')
    })

    it('should update URL param when session is selected', async () => {
      render(
        <>
          <TestConsumer />
          <TestSetter sessionCmId={1002} />
          <UrlParamViewer />
        </>,
        { wrapper: createWrapper() }
      )

      expect(screen.getByTestId('url-session')).toHaveTextContent('none')

      await act(async () => {
        screen.getByTestId('set-session').click()
      })

      expect(screen.getByTestId('url-session')).toHaveTextContent('1002')
    })

    it('should clear URL param when session is set to null', async () => {
      render(
        <>
          <TestConsumer />
          <TestSetter sessionCmId={null} />
          <UrlParamViewer />
        </>,
        { wrapper: createWrapper('/metrics/registration?session=1001') }
      )

      expect(screen.getByTestId('url-session')).toHaveTextContent('1001')

      await act(async () => {
        screen.getByTestId('set-session').click()
      })

      expect(screen.getByTestId('url-session')).toHaveTextContent('none')
    })
  })

  describe('clearSession', () => {
    it('should reset session to null', async () => {
      render(
        <>
          <TestConsumer />
          <TestClearer />
        </>,
        { wrapper: createWrapper('/metrics/registration?session=1001') }
      )

      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('1001')

      await act(async () => {
        screen.getByTestId('clear-session').click()
      })

      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('null')
    })

    it('should remove session URL param', async () => {
      render(
        <>
          <TestClearer />
          <UrlParamViewer />
        </>,
        {
          wrapper: createWrapper('/metrics/registration?session=1001&year=2026'),
        }
      )

      expect(screen.getByTestId('url-session')).toHaveTextContent('1001')

      await act(async () => {
        screen.getByTestId('clear-session').click()
      })

      expect(screen.getByTestId('url-session')).toHaveTextContent('none')
    })
  })

  describe('selectedSession lookup', () => {
    it('should find session by cm_id when selected', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/metrics/registration?session=1003'),
      })

      expect(screen.getByTestId('selectedSessionName')).toHaveTextContent('Session 2a')
    })

    it('should return undefined when session cm_id not found', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/metrics/registration?session=9999'),
      })

      // Should still have the cm_id but no matching session
      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('9999')
      expect(screen.getByTestId('selectedSessionName')).toHaveTextContent('All Sessions')
    })
  })

  describe('URL param edge cases', () => {
    it('should handle invalid session param gracefully', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/metrics/registration?session=invalid'),
      })

      // Invalid param should be ignored, default to null
      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('null')
    })

    it('should preserve other URL params when updating session', async () => {
      const queryClient = new QueryClient()
      const mockYearContext: CurrentYearContextType = {
        currentYear: 2026,
        setCurrentYear: vi.fn(),
        availableYears: [2026, 2025, 2024],
        isTransitioning: false,
      }

      // Component that shows year param
      function YearParamViewer() {
        const [searchParams] = useSearchParams()
        return <span data-testid="url-year">{searchParams.get('year') ?? 'none'}</span>
      }

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/metrics/registration?year=2025']}>
            <CurrentYearContext.Provider value={mockYearContext}>
              <MetricsSessionProvider>
                <TestSetter sessionCmId={1001} />
                <YearParamViewer />
                <UrlParamViewer />
              </MetricsSessionProvider>
            </CurrentYearContext.Provider>
          </MemoryRouter>
        </QueryClientProvider>
      )

      expect(screen.getByTestId('url-year')).toHaveTextContent('2025')

      await act(async () => {
        screen.getByTestId('set-session').click()
      })

      // Year should be preserved
      expect(screen.getByTestId('url-year')).toHaveTextContent('2025')
      expect(screen.getByTestId('url-session')).toHaveTextContent('1001')
    })
  })

  describe('useMetricsSession hook', () => {
    it('should throw when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<TestConsumer />)
      }).toThrow('useMetricsSession must be used within a MetricsSessionProvider')

      consoleSpy.mockRestore()
    })
  })
})

describe('URL param parsing logic', () => {
  describe('parseSessionParam', () => {
    function parseSessionParam(param: string | null): number | null {
      if (!param) return null
      const parsed = parseInt(param, 10)
      return isNaN(parsed) ? null : parsed
    }

    it('should return null for null input', () => {
      expect(parseSessionParam(null)).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(parseSessionParam('')).toBeNull()
    })

    it('should return null for non-numeric string', () => {
      expect(parseSessionParam('abc')).toBeNull()
    })

    it('should parse valid numeric string', () => {
      expect(parseSessionParam('1001')).toBe(1001)
    })

    it('should handle negative numbers', () => {
      expect(parseSessionParam('-1')).toBe(-1)
    })
  })
})
