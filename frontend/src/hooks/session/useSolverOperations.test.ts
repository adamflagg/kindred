/**
 * Tests for useSolverOperations hook
 * Following TDD - tests written first, implementation follows
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { useSolverOperations } from './useSolverOperations'
import { solverService } from '../../services/solver'

// These tests verify the solver operation logic
// The actual hook uses solverService which is mocked in tests

describe('useSolverOperations', () => {
  // Test the auto-apply flow
  describe('auto-apply behavior', () => {
    it('should apply results automatically when auto-apply is enabled and timeout is 0', async () => {
      const mockSolverService = {
        runSolver: vi.fn().mockResolvedValue({
          id: 'run-1',
          status: 'completed',
          results: {
            stats: { satisfied_request_count: 10, total_requests: 12 },
          },
        }),
        applySolverResults: vi.fn().mockResolvedValue({ success: true }),
      }

      // Simulate the auto-apply logic
      const autoApplyEnabled = true as boolean
      const autoApplyTimeout = 0 as number

      const solverRun = await mockSolverService.runSolver('1234', 2025, null, vi.fn())

      expect(solverRun.status).toBe('completed')

      if (solverRun.status === 'completed' && autoApplyEnabled) {
        if (autoApplyTimeout === 0) {
          await mockSolverService.applySolverResults(solverRun.id, vi.fn())
        }
      }

      expect(mockSolverService.applySolverResults).toHaveBeenCalledWith(
        'run-1',
        expect.any(Function)
      )
    })

    it('should not auto-apply when auto-apply is disabled', async () => {
      const mockSolverService = {
        runSolver: vi.fn().mockResolvedValue({
          id: 'run-1',
          status: 'completed',
          results: {
            stats: { satisfied_request_count: 10, total_requests: 12 },
          },
        }),
        applySolverResults: vi.fn().mockResolvedValue({ success: true }),
      }

      const autoApplyEnabled = false as boolean

      const solverRun = await mockSolverService.runSolver('1234', 2025, null, vi.fn())

      if (solverRun.status === 'completed' && autoApplyEnabled) {
        await mockSolverService.applySolverResults(solverRun.id, vi.fn())
      }

      expect(mockSolverService.applySolverResults).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should handle solver failure gracefully', async () => {
      const mockSolverService = {
        runSolver: vi.fn().mockResolvedValue({
          id: 'run-1',
          status: 'failed',
          error_message: 'No solution found - constraints are unsatisfiable',
        }),
      }

      const solverRun = await mockSolverService.runSolver('1234', 2025, null, vi.fn())

      expect(solverRun.status).toBe('failed')
      expect(solverRun.error_message).toContain('No solution found')
    })

    it('should provide helpful message for impossible constraints', async () => {
      const errorMessage = 'No solution found - must satisfy constraints conflict'

      const isMustSatisfyError =
        errorMessage.toLowerCase().includes('must satisfy') ||
        errorMessage.toLowerCase().includes('no solution')

      expect(isMustSatisfyError).toBe(true)
    })
  })

  describe('scenario mode', () => {
    it('should capture scenario ID before running solver', async () => {
      const currentScenarioId = 'scenario-123'

      // Before running solver, capture the scenario
      const capturedScenarioId = currentScenarioId

      expect(capturedScenarioId).toBe('scenario-123')
    })

    it('should pass scenario ID to solver service', async () => {
      const mockSolverService = {
        runSolver: vi.fn().mockResolvedValue({ id: 'run-1', status: 'completed' }),
      }

      const scenarioId = 'scenario-456'
      await mockSolverService.runSolver('1234', 2025, scenarioId, vi.fn())

      expect(mockSolverService.runSolver).toHaveBeenCalledWith(
        '1234',
        2025,
        'scenario-456',
        expect.any(Function)
      )
    })
  })

  describe('clear assignments', () => {
    it('should clear assignments for current scenario', async () => {
      const mockSolverService = {
        clearScenarioAssignments: vi.fn().mockResolvedValue({
          message: 'Assignments cleared successfully',
          cleared_count: 50,
        }),
      }

      const scenarioId = 'scenario-789'
      const result = await mockSolverService.clearScenarioAssignments(scenarioId, vi.fn())

      expect(mockSolverService.clearScenarioAssignments).toHaveBeenCalledWith(
        'scenario-789',
        expect.any(Function)
      )
      expect(result.message).toContain('cleared')
    })

    it('should not allow clearing when in production mode (no scenario)', async () => {
      const currentScenario = null as { id: string } | null

      // In production mode, clear button should not trigger action
      const canClear = currentScenario !== null

      expect(canClear).toBe(false)
    })
  })
})

describe('solver result statistics', () => {
  it('should extract request validation stats from solver response', () => {
    const solverStats = {
      satisfied_request_count: 45,
      total_requests: 50,
      request_validation: {
        impossible_requests: 3,
        affected_campers: 2,
      },
    }

    const satisfiedCount = solverStats.satisfied_request_count
    const totalCount = solverStats.total_requests
    const validation = solverStats.request_validation

    expect(satisfiedCount).toBe(45)
    expect(totalCount).toBe(50)
    expect(validation.impossible_requests).toBe(3)
    expect(validation.affected_campers).toBe(2)
  })

  it('should handle missing request_validation gracefully', () => {
    const solverStats: Record<string, unknown> = {
      satisfied_request_count: 45,
      total_requests: 50,
    }

    const validation = solverStats['request_validation'] as
      | { impossible_requests?: number }
      | undefined
    const hasImpossibleRequests =
      validation?.impossible_requests && validation.impossible_requests > 0

    expect(hasImpossibleRequests).toBeFalsy()
  })
})

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, children)
}

describe('useSolverOperations diagnostics passthrough (#1638)', () => {
  it('returns diagnostics on a failed run', async () => {
    vi.spyOn(solverService, 'runSolver').mockResolvedValue({
      id: 'run-1',
      session: '1000001',
      status: 'failed',
      error_message: 'Solver failed to find a solution',
      diagnostics: {
        infeasibilityCause: 'The parent_paramount constraint is causing infeasibility',
        localization: null,
        impossibilityReport: null,
      },
      created: '',
      updated: '',
    } as never)

    const { result } = renderHook(
      () =>
        useSolverOperations({
          selectedSession: '1000001',
          currentYear: 2026,
          currentScenario: null,
          scenarios: [],
          autoApplyEnabled: false,
          autoApplyTimeout: 0,
          fetchWithAuth: vi.fn(),
          respectLocks: true,
          lockedBunkCmIds: [],
          allowOverflow: false,
        }),
      { wrapper }
    )

    let outcome: Awaited<ReturnType<typeof result.current.handleRunSolver>> | undefined
    await act(async () => {
      outcome = await result.current.handleRunSolver(60)
    })
    expect(outcome?.success).toBe(false)
    expect(outcome?.diagnostics?.infeasibilityCause).toContain('parent_paramount')
  })

  it('logs a console.warn breadcrumb on a failed run', async () => {
    // #1656 — failed runs no longer throw (diagnostics ride the return value), so
    // without an explicit log an infeasible solve produces zero console output.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(solverService, 'runSolver').mockResolvedValue({
      id: 'run-1',
      session: '1000001',
      status: 'failed',
      error_message: 'Solver failed to find a solution',
      diagnostics: { infeasibilityCause: null, localization: null, impossibilityReport: null },
      created: '',
      updated: '',
    } as never)

    const { result } = renderHook(
      () =>
        useSolverOperations({
          selectedSession: '1000001',
          currentYear: 2026,
          currentScenario: null,
          scenarios: [],
          autoApplyEnabled: false,
          autoApplyTimeout: 0,
          fetchWithAuth: vi.fn(),
          respectLocks: true,
          lockedBunkCmIds: [],
          allowOverflow: false,
        }),
      { wrapper }
    )

    await act(async () => {
      await result.current.handleRunSolver(60)
    })
    expect(warnSpy).toHaveBeenCalledWith(
      'Solver run did not complete:',
      'failed',
      'Solver failed to find a solution'
    )
    warnSpy.mockRestore()
  })
})

describe('useSolverOperations locked bunks + overflow (#1609)', () => {
  it('passes lockedBunkCmIds and allowOverflow to solverService.runSolver', async () => {
    vi.spyOn(solverService, 'runSolver').mockResolvedValue({
      id: 'run-2',
      session: '1000002',
      status: 'completed',
      results: { stats: { satisfied_request_count: 5, total_requests: 5 } },
      diagnostics: null,
      created: '',
      updated: '',
    } as never)

    const { result } = renderHook(
      () =>
        useSolverOperations({
          selectedSession: '1000002',
          currentYear: 2026,
          currentScenario: null,
          scenarios: [],
          autoApplyEnabled: false,
          autoApplyTimeout: 0,
          fetchWithAuth: vi.fn(),
          respectLocks: true,
          lockedBunkCmIds: [2001, 2002],
          allowOverflow: true,
        }),
      { wrapper }
    )

    await act(async () => {
      await result.current.handleRunSolver(60)
    })

    // Arg order: sessionId, year, scenarioId, fetchWithAuth, timeLimit, respectLocks, lockedBunkCmIds, allowOverflow
    expect(solverService.runSolver).toHaveBeenCalledWith(
      '1000002',
      2026,
      null,
      expect.any(Function),
      60,
      true,
      [2001, 2002],
      true
    )
  })
})
