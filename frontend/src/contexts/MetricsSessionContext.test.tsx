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
      {
        cm_id: 2001,
        name: 'Teen Adventure Quest',
        session_type: 'quest',
        start_date: '2026-06-10',
      },
    ],
    isLoading: false,
  })),
}))

// Test component that displays context values
function TestConsumer() {
  const {
    selectedSessionCmId,
    selectedSession,
    sessions,
    isLoading,
    viewMode,
    activeSessionTypes,
    sessionTypesParam,
    campSessions,
    questSessions,
  } = useMetricsSession()
  return (
    <div>
      <span data-testid="selectedSessionCmId">{selectedSessionCmId ?? 'null'}</span>
      <span data-testid="selectedSessionName">{selectedSession?.name ?? 'All Sessions'}</span>
      <span data-testid="sessionsCount">{sessions.length}</span>
      <span data-testid="isLoading">{isLoading ? 'true' : 'false'}</span>
      <span data-testid="viewMode">{viewMode}</span>
      <span data-testid="activeSessionTypes">{activeSessionTypes.join(',')}</span>
      <span data-testid="sessionTypesParam">{sessionTypesParam}</span>
      <span data-testid="campSessionsCount">{campSessions.length}</span>
      <span data-testid="questSessionsCount">{questSessions.length}</span>
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

// Test component that sets view mode
function TestViewModeSetter({ mode }: { mode: 'sessions' | 'quests' | 'all' }) {
  const { setViewMode } = useMetricsSession()
  return (
    <button onClick={() => setViewMode(mode)} data-testid="set-view-mode">
      Set View Mode
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
function createWrapper(initialPath: string = '/analytics/registration') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const mockYearContext: CurrentYearContextType = {
    currentYear: 2026,
    setCurrentYear: vi.fn(),
    availableYears: [2026, 2025, 2024, 2023, 2022],
    isTransitioning: false,
    isYearReady: true,
  }

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <CurrentYearContext value={mockYearContext}>
            <MetricsSessionProvider>{children}</MetricsSessionProvider>
          </CurrentYearContext>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('MetricsSessionContext', () => {
  describe('initial state', () => {
    it('should default to null (all sessions) when no URL param', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration'),
      })

      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('null')
      expect(screen.getByTestId('selectedSessionName')).toHaveTextContent('All Sessions')
    })

    it('should read session from URL param on init', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration?session=1001'),
      })

      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('1001')
      expect(screen.getByTestId('selectedSessionName')).toHaveTextContent('Session 1')
    })

    it('should provide sessions from useMetricsSessions', () => {
      render(<TestConsumer />, { wrapper: createWrapper() })

      expect(screen.getByTestId('sessionsCount')).toHaveTextContent('4')
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
        { wrapper: createWrapper('/analytics/registration?session=1001') }
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
        { wrapper: createWrapper('/analytics/registration?session=1001') }
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
          wrapper: createWrapper('/analytics/registration?session=1001&year=2026'),
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
        wrapper: createWrapper('/analytics/registration?session=1003'),
      })

      expect(screen.getByTestId('selectedSessionName')).toHaveTextContent('Session 2a')
    })

    it('should return undefined when session cm_id not found', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration?session=9999'),
      })

      // Should still have the cm_id but no matching session
      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('9999')
      expect(screen.getByTestId('selectedSessionName')).toHaveTextContent('All Sessions')
    })
  })

  describe('URL param edge cases', () => {
    it('should handle invalid session param gracefully', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration?session=invalid'),
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
        isYearReady: true,
      }

      // Component that shows year param
      function YearParamViewer() {
        const [searchParams] = useSearchParams()
        return <span data-testid="url-year">{searchParams.get('year') ?? 'none'}</span>
      }

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/analytics/registration?year=2025']}>
            <CurrentYearContext value={mockYearContext}>
              <MetricsSessionProvider>
                <TestSetter sessionCmId={1001} />
                <YearParamViewer />
                <UrlParamViewer />
              </MetricsSessionProvider>
            </CurrentYearContext>
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

describe('MetricsSessionContext viewMode', () => {
  describe('initial state', () => {
    it('should default to sessions viewMode when no URL param', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration'),
      })

      expect(screen.getByTestId('viewMode')).toHaveTextContent('sessions')
    })

    it('should read viewMode from URL ?view=quests param', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration?view=quests'),
      })

      expect(screen.getByTestId('viewMode')).toHaveTextContent('quests')
    })

    it('should default to sessions for invalid view param', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration?view=invalid'),
      })

      expect(screen.getByTestId('viewMode')).toHaveTextContent('sessions')
    })
  })

  describe('activeSessionTypes', () => {
    it('should return camp session types in sessions mode', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration'),
      })

      expect(screen.getByTestId('activeSessionTypes')).toHaveTextContent('main,embedded,ag')
    })

    it('should return quest session types in quests mode', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration?view=quests'),
      })

      expect(screen.getByTestId('activeSessionTypes')).toHaveTextContent('quest')
    })

    it('should return all session types when specific session selected', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration?session=1001'),
      })

      expect(screen.getByTestId('activeSessionTypes')).toHaveTextContent('main,embedded,ag,quest')
    })
  })

  describe('sessionTypesParam', () => {
    it('should be comma-joined activeSessionTypes for sessions mode', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration'),
      })

      expect(screen.getByTestId('sessionTypesParam')).toHaveTextContent('main,embedded,ag')
    })

    it('should be "quest" for quests mode', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration?view=quests'),
      })

      expect(screen.getByTestId('sessionTypesParam')).toHaveTextContent('quest')
    })
  })

  describe('campSessions and questSessions', () => {
    it('should split sessions into camp and quest groups', () => {
      render(<TestConsumer />, { wrapper: createWrapper() })

      // 3 camp sessions (Session 1, Session 2, Session 2a), 1 quest
      expect(screen.getByTestId('campSessionsCount')).toHaveTextContent('3')
      expect(screen.getByTestId('questSessionsCount')).toHaveTextContent('1')
    })

    it('should include 4 total sessions', () => {
      render(<TestConsumer />, { wrapper: createWrapper() })

      expect(screen.getByTestId('sessionsCount')).toHaveTextContent('4')
    })
  })

  describe('setViewMode', () => {
    it('should update viewMode and URL param', async () => {
      render(
        <>
          <TestConsumer />
          <TestViewModeSetter mode="quests" />
          <UrlParamViewer />
        </>,
        { wrapper: createWrapper() }
      )

      expect(screen.getByTestId('viewMode')).toHaveTextContent('sessions')

      await act(async () => {
        screen.getByTestId('set-view-mode').click()
      })

      expect(screen.getByTestId('viewMode')).toHaveTextContent('quests')
    })

    it('should clear session param when switching view mode', async () => {
      render(
        <>
          <TestConsumer />
          <TestViewModeSetter mode="quests" />
          <UrlParamViewer />
        </>,
        { wrapper: createWrapper('/analytics/registration?session=1001') }
      )

      expect(screen.getByTestId('url-session')).toHaveTextContent('1001')

      await act(async () => {
        screen.getByTestId('set-view-mode').click()
      })

      expect(screen.getByTestId('url-session')).toHaveTextContent('none')
    })
  })

  describe('setSelectedSessionCmId clears view param', () => {
    it('should clear view param when specific session selected', async () => {
      function ViewParamViewer() {
        const [searchParams] = useSearchParams()
        return <span data-testid="url-view">{searchParams.get('view') ?? 'none'}</span>
      }

      render(
        <>
          <TestConsumer />
          <TestSetter sessionCmId={1001} />
          <ViewParamViewer />
        </>,
        { wrapper: createWrapper('/analytics/registration?view=quests') }
      )

      expect(screen.getByTestId('url-view')).toHaveTextContent('quests')

      await act(async () => {
        screen.getByTestId('set-session').click()
      })

      expect(screen.getByTestId('url-view')).toHaveTextContent('none')
      expect(screen.getByTestId('selectedSessionCmId')).toHaveTextContent('1001')
    })
  })
})

describe('MetricsSessionContext "all" viewMode', () => {
  describe('initial state', () => {
    it('should read viewMode "all" from URL ?view=all param', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration?view=all'),
      })

      expect(screen.getByTestId('viewMode')).toHaveTextContent('all')
    })
  })

  describe('activeSessionTypes', () => {
    it('should return all session types in "all" mode', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration?view=all'),
      })

      expect(screen.getByTestId('activeSessionTypes')).toHaveTextContent('main,embedded,ag,quest')
    })
  })

  describe('sessionTypesParam', () => {
    it('should be all types comma-joined in "all" mode', () => {
      render(<TestConsumer />, {
        wrapper: createWrapper('/analytics/registration?view=all'),
      })

      expect(screen.getByTestId('sessionTypesParam')).toHaveTextContent('main,embedded,ag,quest')
    })
  })

  describe('setViewMode to all', () => {
    it('should update viewMode to "all" and set URL param', async () => {
      function ViewParamViewer() {
        const [searchParams] = useSearchParams()
        return <span data-testid="url-view">{searchParams.get('view') ?? 'none'}</span>
      }

      render(
        <>
          <TestConsumer />
          <TestViewModeSetter mode="all" />
          <ViewParamViewer />
        </>,
        { wrapper: createWrapper() }
      )

      expect(screen.getByTestId('viewMode')).toHaveTextContent('sessions')

      await act(async () => {
        screen.getByTestId('set-view-mode').click()
      })

      expect(screen.getByTestId('viewMode')).toHaveTextContent('all')
      expect(screen.getByTestId('url-view')).toHaveTextContent('all')
    })

    it('should clear session param when switching to "all" mode', async () => {
      render(
        <>
          <TestConsumer />
          <TestViewModeSetter mode="all" />
          <UrlParamViewer />
        </>,
        { wrapper: createWrapper('/analytics/registration?session=1001') }
      )

      expect(screen.getByTestId('url-session')).toHaveTextContent('1001')

      await act(async () => {
        screen.getByTestId('set-view-mode').click()
      })

      expect(screen.getByTestId('url-session')).toHaveTextContent('none')
    })
  })
})
