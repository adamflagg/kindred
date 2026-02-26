import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import { CurrentYearContext, type CurrentYearContextType } from './useCurrentYear'
import { MetricsSessionContext, type MetricsSessionContextType } from './useMetricsSession'

// Mock useApiWithAuth to provide a fetchWithAuth function
const mockFetchWithAuth = vi.fn()
vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: mockFetchWithAuth, isAuthenticated: true }),
}))

// Dynamically import the hook after mocks are set up
const { useMetricsPrefetch } = await import('./useMetricsPrefetch')

function createCurrentYearContext(currentYear: number): CurrentYearContextType {
  return {
    currentYear,
    setCurrentYear: vi.fn(),
    availableYears: [currentYear - 1, currentYear],
    isTransitioning: false,
    isYearReady: true,
  }
}

function createMetricsSessionContext(
  overrides: Partial<MetricsSessionContextType> = {}
): MetricsSessionContextType {
  return {
    selectedSessionCmId: null,
    selectedSession: undefined,
    sessions: [],
    isLoading: false,
    setSelectedSessionCmId: vi.fn(),
    clearSession: vi.fn(),
    viewMode: 'sessions',
    setViewMode: vi.fn(),
    activeSessionTypes: ['main', 'embedded', 'ag'],
    sessionTypesParam: 'main,embedded,ag',
    campSessions: [],
    questSessions: [],
    expandedRetention: false,
    setExpandedRetention: vi.fn(),
    compareYear: null,
    setCompareYear: vi.fn(),
    isComparing: false,
    ...overrides,
  }
}

function createWrapper(
  queryClient: QueryClient,
  currentYear: number,
  metricsSession: Partial<MetricsSessionContextType> = {}
) {
  const yearCtx = createCurrentYearContext(currentYear)
  const sessionCtx = createMetricsSessionContext(metricsSession)

  return ({ children }: { children: React.ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        CurrentYearContext.Provider,
        { value: yearCtx },
        createElement(MetricsSessionContext.Provider, { value: sessionCtx }, children)
      )
    )
}

describe('useMetricsPrefetch', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    })
    vi.clearAllMocks()
    // Make fetchWithAuth return a successful response by default
    mockFetchWithAuth.mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  })

  afterEach(() => {
    queryClient.clear()
  })

  it('should prefetch registration, retention, and historical on mount when year > 0', async () => {
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery')
    const currentYear = 2025
    const sessionTypesParam = 'main,embedded,ag'

    renderHook(() => useMetricsPrefetch(), {
      wrapper: createWrapper(queryClient, currentYear),
    })

    // Should fire 3 prefetch calls
    expect(prefetchSpy).toHaveBeenCalledTimes(3)

    // Registration prefetch with correct query key
    expect(prefetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.registration(currentYear, sessionTypesParam, 'enrolled', undefined),
        ...syncDataOptions,
      })
    )

    // Retention prefetch with correct query key (currentYear - 1 → currentYear)
    expect(prefetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.retention(currentYear - 1, currentYear, sessionTypesParam, undefined),
        ...syncDataOptions,
      })
    )

    // Historical prefetch with correct query key
    expect(prefetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.historical(undefined, sessionTypesParam, undefined),
        ...syncDataOptions,
      })
    )
  })

  it('should not prefetch when year <= 0', () => {
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery')

    renderHook(() => useMetricsPrefetch(), {
      wrapper: createWrapper(queryClient, 0),
    })

    expect(prefetchSpy).not.toHaveBeenCalled()
  })

  it('should pass sessionCmId when a session is selected', () => {
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery')
    const currentYear = 2025
    const sessionCmId = 500123
    const sessionTypesParam = 'main,embedded,ag'

    renderHook(() => useMetricsPrefetch(), {
      wrapper: createWrapper(queryClient, currentYear, {
        selectedSessionCmId: sessionCmId,
      }),
    })

    expect(prefetchSpy).toHaveBeenCalledTimes(3)

    // Registration should include sessionCmId
    expect(prefetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.registration(currentYear, sessionTypesParam, 'enrolled', sessionCmId),
      })
    )

    // Retention should include sessionCmId
    expect(prefetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.retention(currentYear - 1, currentYear, sessionTypesParam, sessionCmId),
      })
    )

    // Historical should include sessionCmId
    expect(prefetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.historical(undefined, sessionTypesParam, sessionCmId),
      })
    )
  })

  it('should re-prefetch when session filter changes', () => {
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery')
    const currentYear = 2025

    const { rerender } = renderHook(() => useMetricsPrefetch(), {
      wrapper: createWrapper(queryClient, currentYear, {
        selectedSessionCmId: null,
        sessionTypesParam: 'main,embedded,ag',
      }),
    })

    expect(prefetchSpy).toHaveBeenCalledTimes(3)

    // Change session filter
    prefetchSpy.mockClear()
    rerender()

    // Re-render with same wrapper doesn't re-fire (same deps)
    // To test re-fire, we need to change the wrapper
    const newWrapper = createWrapper(queryClient, currentYear, {
      selectedSessionCmId: 500123,
      sessionTypesParam: 'main,embedded,ag,quest',
    })

    const { unmount } = renderHook(() => useMetricsPrefetch(), {
      wrapper: newWrapper,
    })

    // New mount with different session filter fires 3 more prefetches
    expect(prefetchSpy).toHaveBeenCalledTimes(3)
    unmount()
  })

  it('should use syncDataOptions (1hr staleTime) for all prefetches', () => {
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery')

    renderHook(() => useMetricsPrefetch(), {
      wrapper: createWrapper(queryClient, 2025),
    })

    for (const call of prefetchSpy.mock.calls) {
      const options = call[0]
      expect(options).toMatchObject(syncDataOptions)
    }
  })

  it('should use correct sessionTypesParam from context', () => {
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery')
    const questTypes = 'quest'

    renderHook(() => useMetricsPrefetch(), {
      wrapper: createWrapper(queryClient, 2025, {
        sessionTypesParam: questTypes,
      }),
    })

    // All prefetches should use the quest session types
    expect(prefetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.registration(2025, questTypes, 'enrolled', undefined),
      })
    )
    expect(prefetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.retention(2024, 2025, questTypes, undefined),
      })
    )
    expect(prefetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.historical(undefined, questTypes, undefined),
      })
    )
  })
})
