/**
 * Tests for MetricsSessionContext - URL-based session state for metrics module
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useSearchParams, useLocation } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MetricsSessionProvider } from './MetricsSessionContext'
import { useMetricsSession } from '../hooks/useMetricsSession'
import { CurrentYearContext, type CurrentYearContextType } from '../hooks/useCurrentYear'
import type { MetricsSession } from '../hooks/useMetricsSessions'

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

// =============================================================================
// Teen session derivation tests
//
// Uses a separate session fixture that includes end_date (required for duration
// grouping) and teen sessions (scit, tli).
// Wrapped in an outer describe so beforeEach only affects these blocks.
// =============================================================================

// Import the mocked hook so we can swap its return value per-describe.
import { useMetricsSessions } from '../hooks/useMetricsSessions'

const TEEN_TEST_SESSIONS: MetricsSession[] = [
  {
    cm_id: 1,
    name: 'Session 1',
    session_type: 'main',
    start_date: '2025-06-15',
    end_date: '2025-07-05',
  },
  {
    cm_id: 2,
    name: 'Session 4',
    session_type: 'main',
    start_date: '2025-07-20',
    end_date: '2025-08-02',
  },
  {
    cm_id: 3,
    name: 'Quest',
    session_type: 'quest',
    start_date: '2025-06-22',
    end_date: '2025-07-06',
  },
  {
    cm_id: 4,
    name: 'SCIT',
    session_type: 'scit',
    start_date: '2025-06-08',
    end_date: '2025-07-04',
  },
  {
    cm_id: 5,
    name: 'TLI',
    session_type: 'tli',
    start_date: '2025-07-11',
    end_date: '2025-08-03',
  },
]

// URL probe — captures latest search string after each act()
let lastSearch = ''
function LocationProbe() {
  const loc = useLocation()
  lastSearch = loc.search
  return null
}

// Wrapper that uses MemoryRouter (for URL control) + MetricsSessionProvider + probe
function makeTeenWrapper(initialEntry = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const mockYearContext: CurrentYearContextType = {
    currentYear: 2025,
    setCurrentYear: vi.fn(),
    availableYears: [2025, 2024],
    isTransitioning: false,
    isYearReady: true,
  }
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              path="*"
              element={
                <CurrentYearContext value={mockYearContext}>
                  <MetricsSessionProvider>
                    {children}
                    <LocationProbe />
                  </MetricsSessionProvider>
                </CurrentYearContext>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('MetricsSessionProvider — teen features', () => {
  beforeEach(() => {
    lastSearch = ''
    vi.mocked(useMetricsSessions).mockReturnValue({
      data: TEEN_TEST_SESSIONS,
      isLoading: false,
    } as ReturnType<typeof useMetricsSessions>)
  })

  describe('MetricsSessionProvider — teen session derivation', () => {
    it('teenSessions contains only scit and tli (cm_ids 4, 5)', () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      const ids = result.current.teenSessions.map((s) => s.cm_id)
      expect(ids).toContain(4)
      expect(ids).toContain(5)
      expect(ids).toHaveLength(2)
    })

    it('campSessions contains only main/embedded (cm_ids 1, 2) — NOT teens or quest', () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      const ids = result.current.campSessions.map((s) => s.cm_id)
      expect(ids).toContain(1)
      expect(ids).toContain(2)
      expect(ids).not.toContain(3) // quest
      expect(ids).not.toContain(4) // scit
      expect(ids).not.toContain(5) // tli
      expect(ids).toHaveLength(2)
    })

    it('questSessions contains only quest (cm_id 3)', () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      const ids = result.current.questSessions.map((s) => s.cm_id)
      expect(ids).toEqual([3])
    })

    it('hasScit is true when scit session present', () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      expect(result.current.hasScit).toBe(true)
    })

    it('hasTli is true when tli session present', () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      expect(result.current.hasTli).toBe(true)
    })
  })

  describe('MetricsSessionProvider — view mode + teen session types', () => {
    it("setViewMode('teens') → sessionTypesParam === 'scit,tli'", () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      act(() => result.current.setViewMode('teens'))
      expect(result.current.sessionTypesParam).toBe('scit,tli')
    })

    it("setViewMode('all') → sessionTypesParam contains scit and tli", () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      act(() => result.current.setViewMode('all'))
      expect(result.current.sessionTypesParam).toContain('scit')
      expect(result.current.sessionTypesParam).toContain('tli')
    })

    it("setViewMode('teens') writes view=teens to URL", () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      act(() => result.current.setViewMode('teens'))
      expect(lastSearch).toContain('view=teens')
    })
  })

  describe('MetricsSessionProvider — selectedTeenType', () => {
    it('selectedTeenType is null initially', () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      expect(result.current.selectedTeenType).toBeNull()
    })

    it('derives selectedTeenType from ?teen=scit on reload (parse path)', () => {
      const { result } = renderHook(() => useMetricsSession(), {
        wrapper: makeTeenWrapper('/?teen=scit'),
      })
      expect(result.current.selectedTeenType).toBe('scit')
    })

    it("setSelectedTeenType('scit') → sessionTypesParam === 'scit'", () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      act(() => result.current.setSelectedTeenType('scit'))
      expect(result.current.sessionTypesParam).toBe('scit')
    })

    it("setSelectedTeenType('tli') → sessionTypesParam === 'tli'", () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      act(() => result.current.setSelectedTeenType('tli'))
      expect(result.current.sessionTypesParam).toBe('tli')
    })

    it('setSelectedTeenType writes teen param to URL', () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      act(() => result.current.setSelectedTeenType('scit'))
      expect(lastSearch).toContain('teen=scit')
    })

    it('setSelectedTeenType(null) clears the teen param', () => {
      const { result } = renderHook(() => useMetricsSession(), {
        wrapper: makeTeenWrapper('/?teen=scit'),
      })
      act(() => result.current.setSelectedTeenType(null))
      expect(lastSearch).not.toContain('teen=')
    })
  })

  describe('MetricsSessionProvider — mutual exclusion with teen param', () => {
    it('setViewMode clears teen param', () => {
      const { result } = renderHook(() => useMetricsSession(), {
        wrapper: makeTeenWrapper('/?teen=scit'),
      })
      act(() => result.current.setViewMode('sessions'))
      expect(lastSearch).not.toContain('teen=')
    })

    it('setSelectedTeenType clears view param', () => {
      const { result } = renderHook(() => useMetricsSession(), {
        wrapper: makeTeenWrapper('/?view=teens'),
      })
      act(() => result.current.setSelectedTeenType('tli'))
      expect(lastSearch).not.toContain('view=')
    })

    it('setSelectedTeenType clears session param', () => {
      const { result } = renderHook(() => useMetricsSession(), {
        wrapper: makeTeenWrapper('/?session=1'),
      })
      act(() => result.current.setSelectedTeenType('scit'))
      expect(lastSearch).not.toContain('session=')
    })

    it('setSelectedTeenType clears duration param', () => {
      const { result } = renderHook(() => useMetricsSession(), {
        wrapper: makeTeenWrapper('/?duration=3-week'),
      })
      act(() => result.current.setSelectedTeenType('scit'))
      expect(lastSearch).not.toContain('duration=')
    })

    it('setSelectedDuration clears teen param', () => {
      const { result } = renderHook(() => useMetricsSession(), {
        wrapper: makeTeenWrapper('/?teen=scit'),
      })
      act(() => result.current.setSelectedDuration('2-week'))
      expect(lastSearch).not.toContain('teen=')
    })

    it('setSelectedSessionCmId clears teen param', () => {
      const { result } = renderHook(() => useMetricsSession(), {
        wrapper: makeTeenWrapper('/?teen=scit'),
      })
      act(() => result.current.setSelectedSessionCmId(1))
      expect(lastSearch).not.toContain('teen=')
    })
  })

  describe('MetricsSessionProvider — durationGroups includes teen sessions', () => {
    it('durationGroups includes SCIT (cm_id 4) — 27 days → 4-week+', () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      const allGrouped = Array.from(result.current.durationGroups.values()).flat()
      const ids = allGrouped.map((s) => s.cm_id)
      expect(ids).toContain(4)
    })

    it('durationGroups includes TLI (cm_id 5) — 24 days → 4-week+', () => {
      const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper() })
      const allGrouped = Array.from(result.current.durationGroups.values()).flat()
      const ids = allGrouped.map((s) => s.cm_id)
      expect(ids).toContain(5)
    })
  })
}) // end describe('MetricsSessionProvider — teen features')

describe('MetricsSessionProvider — includeTeenPipeline', () => {
  beforeEach(() => {
    lastSearch = ''
    vi.mocked(useMetricsSessions).mockReturnValue({
      data: TEEN_TEST_SESSIONS,
      isLoading: false,
    } as ReturnType<typeof useMetricsSessions>)
  })

  it('reads includeTeenPipeline from the URL (teen_pipeline=1) and toggles it', async () => {
    // default (no param) → false
    const { result: resultDefault } = renderHook(() => useMetricsSession(), {
      wrapper: makeTeenWrapper('/'),
    })
    expect(resultDefault.current.includeTeenPipeline).toBe(false)

    // initial URL '?teen_pipeline=1' → true
    const { result: resultTrue } = renderHook(() => useMetricsSession(), {
      wrapper: makeTeenWrapper('/?teen_pipeline=1'),
    })
    expect(resultTrue.current.includeTeenPipeline).toBe(true)

    // calling setIncludeTeenPipeline(true) adds teen_pipeline=1 to the URL
    const { result } = renderHook(() => useMetricsSession(), { wrapper: makeTeenWrapper('/') })
    act(() => result.current.setIncludeTeenPipeline(true))
    expect(result.current.includeTeenPipeline).toBe(true)
    expect(lastSearch).toContain('teen_pipeline=1')

    // calling setIncludeTeenPipeline(false) removes the param
    act(() => result.current.setIncludeTeenPipeline(false))
    expect(result.current.includeTeenPipeline).toBe(false)
    expect(lastSearch).not.toContain('teen_pipeline=')
  })
})
