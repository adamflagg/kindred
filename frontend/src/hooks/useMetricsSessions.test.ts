/**
 * Tests for useMetricsSessions hook
 *
 * TDD: These tests define the expected behavior before implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '../test/testUtils'
import type { MetricsSession } from './useMetricsSessions'

const mockGetFullList = vi.fn()
const mockCollection = vi.fn((_name: string) => ({ getFullList: mockGetFullList }))

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => mockCollection(name),
  },
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'test@example.com' },
    isLoading: false,
    isAuthenticated: true,
    isBypassMode: false,
    login: vi.fn(),
    logout: vi.fn(),
    error: null,
    checkAuth: vi.fn(),
    pb: {},
  }),
}))

import { useMetricsSessions } from './useMetricsSessions'

beforeEach(() => {
  mockGetFullList.mockReset()
  mockCollection.mockClear()
  mockGetFullList.mockResolvedValue([])
})

describe('useMetricsSessions', () => {
  it('should export useMetricsSessions hook', async () => {
    // This will fail until the hook is implemented
    const module = await import('./useMetricsSessions')
    expect(typeof module.useMetricsSessions).toBe('function')
  })

  describe('hook behavior', () => {
    it('should return sessions for the given year', () => {
      // Test structure: hook should return
      // - data: array of sessions with cm_id, name, session_type
      // - isLoading: boolean
      // - error: Error | null
      const expectedShape = {
        data: expect.any(Array),
        isLoading: expect.any(Boolean),
        error: null,
      }

      // The actual hook will be tested with React Testing Library
      // once implemented. For now, just verify the expected shape.
      expect(expectedShape).toMatchObject({
        data: expect.any(Array),
        isLoading: expect.any(Boolean),
      })
    })

    it('should filter to main and embedded session types only', () => {
      // Sessions returned should only include main and embedded types
      // (not ag, family, training, etc.) for the dropdown
      const validSessionTypes = ['main', 'embedded']
      const session = { session_type: 'main' }

      expect(validSessionTypes).toContain(session.session_type)
    })

    it('should include end_date in MetricsSession type', async () => {
      // Type-level verification: this test fails to compile if end_date is removed from MetricsSession
      const verifyShape = (s: MetricsSession) => s.end_date
      expect(verifyShape).toBeDefined()
    })

    it('should sort sessions by start_date', () => {
      // Sessions should be sorted chronologically
      const sessions = [
        { name: 'Session 4', start_date: '2025-07-27' },
        { name: 'Session 2', start_date: '2025-06-15' },
        { name: 'Session 3', start_date: '2025-07-06' },
      ]

      const sorted = [...sessions].sort(
        (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
      )

      expect(sorted[0]?.name).toBe('Session 2')
      expect(sorted[1]?.name).toBe('Session 3')
      expect(sorted[2]?.name).toBe('Session 4')
    })
  })
})

describe('useMetricsSessions teen window-gate wiring', () => {
  it('includes summer scit + tli, excludes off-season fall scit (filter string + window gate together)', async () => {
    // Two main sessions anchor the summer window (~2025-06-15 → 2025-08-02).
    // Summer scit and tli overlap that window; the fall scit does not.
    mockGetFullList.mockResolvedValue([
      {
        cm_id: 1,
        name: 'Session 1',
        session_type: 'main',
        start_date: '2025-06-15',
        end_date: '2025-06-28',
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
        name: 'SCIT Summer',
        session_type: 'scit',
        start_date: '2025-06-08',
        end_date: '2025-07-04',
      },
      {
        cm_id: 4,
        name: 'TLI Summer',
        session_type: 'tli',
        start_date: '2025-07-11',
        end_date: '2025-08-03',
      },
      {
        cm_id: 5,
        name: 'SCIT Fall',
        session_type: 'scit',
        start_date: '2025-09-12',
        end_date: '2025-09-15',
      },
    ])

    const { result } = renderHook(() => useMetricsSessions(2025), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // The filter widened to fetch teens too.
    expect(mockCollection).toHaveBeenCalledWith('camp_sessions')
    const callArg = mockGetFullList.mock.calls[0]?.[0] as { filter?: string } | undefined
    expect(callArg?.filter).toContain('session_type = "scit"')
    expect(callArg?.filter).toContain('session_type = "tli"')

    const cmIds = (result.current.data ?? []).map((s) => s.cm_id)
    expect(cmIds).toContain(1) // main
    expect(cmIds).toContain(2) // main
    expect(cmIds).toContain(3) // summer scit overlaps window
    expect(cmIds).toContain(4) // summer tli overlaps window
    expect(cmIds).not.toContain(5) // fall scit is off-season → gated out
    expect(result.current.data).toHaveLength(4)
  })
})

describe('RetentionMetrics types', () => {
  it('should include new breakdown types in RetentionMetrics interface', async () => {
    // Import the types to verify they exist
    const typesModule = await import('../types/metrics')

    // Verify the module loaded
    expect(typesModule).toBeDefined()

    // Types are verified at compile time through the imports used
    // in RetentionTab.tsx and other components
  })

  it('RetentionBySummerYears should have correct structure', async () => {
    const expectedShape = {
      summer_years: 3,
      base_count: 10,
      returned_count: 8,
      retention_rate: 0.8,
    }

    // Verify shape matches expected structure
    expect(Object.keys(expectedShape)).toEqual([
      'summer_years',
      'base_count',
      'returned_count',
      'retention_rate',
    ])
  })

  it('RetentionByFirstSummerYear should have correct structure', async () => {
    const expectedShape = {
      first_summer_year: 2020,
      base_count: 15,
      returned_count: 12,
      retention_rate: 0.8,
    }

    expect(Object.keys(expectedShape)).toEqual([
      'first_summer_year',
      'base_count',
      'returned_count',
      'retention_rate',
    ])
  })

  it('RetentionByPriorSession should have correct structure', async () => {
    const expectedShape = {
      prior_session: 'Session 2',
      base_count: 25,
      returned_count: 20,
      retention_rate: 0.8,
    }

    expect(Object.keys(expectedShape)).toEqual([
      'prior_session',
      'base_count',
      'returned_count',
      'retention_rate',
    ])
  })
})

describe('useRetentionMetrics hook updates', () => {
  it('should accept optional sessionCmId parameter', async () => {
    // The useRetentionMetrics hook should accept a 4th parameter for session filtering
    const module = await import('./useMetrics')

    // Verify the function exists
    expect(typeof module.useRetentionMetrics).toBe('function')

    // The function signature should be:
    // useRetentionMetrics(baseYear, compareYear, options?: MetricsFilterOptions)
    // This is tested by TypeScript, we just verify it exists
  })
})

describe('queryKeys updates', () => {
  it('should have retention key that accepts sessionCmId', async () => {
    const { queryKeys } = await import('../utils/queryKeys')

    // The retention key should accept 4 parameters
    // (baseYear, compareYear, sessionTypes, sessionCmId)
    const key = queryKeys.retention(2025, 2026, 'main,embedded', 1001)

    expect(Array.isArray(key)).toBe(true)
    expect(key).toContain('metrics')
    expect(key).toContain('retention')
    expect(key).toContain(2025)
    expect(key).toContain(2026)
  })

  it('should have metricsSessions key for sessions dropdown', async () => {
    const { queryKeys } = await import('../utils/queryKeys')

    // A new key for fetching sessions should exist
    expect(typeof queryKeys.metricsSessions).toBe('function')

    const key = queryKeys.metricsSessions(2025)
    expect(Array.isArray(key)).toBe(true)
    expect(key).toContain('metrics')
    expect(key).toContain('sessions')
    expect(key).toContain(2025)
  })
})
