/**
 * Tests for solverService poll-budget behavior.
 *
 * Bug: pollSolverStatus had a hardcoded 60-attempt cap that fires at ~60s
 * regardless of the requested solver time_limit, and runSolver did not
 * thread the requested time_limit through to the poller. A user-selected
 * 300s solve therefore always threw "Solver timeout - took longer than
 * expected" even when the backend was still healthily working and
 * ultimately succeeded.
 *
 * Fix: derive the poll budget from the requested time_limit so a 5m solve
 * gets 5m + buffer of patience, and have runSolver pass timeLimit through.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POLL_BUFFER_SECONDS, solverService } from './solver'

const POLL_INTERVAL_MS = 1000
const TEST_SESSION_ID = '1000001'

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  } as Response
}

function pendingResponse() {
  return jsonResponse({ status: 'pending' })
}

function completedResponse() {
  return jsonResponse({
    status: 'completed',
    session_id: TEST_SESSION_ID,
    started_at: '2026-05-06T21:07:12.000Z',
    completed_at: '2026-05-06T21:12:12.000Z',
    results: { stats: { status: 'FEASIBLE' } },
  })
}

async function advancePolls(count: number) {
  for (let i = 0; i < count; i++) {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
  }
}

describe('solverService.runSolver poll budget', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not give up at 60s when timeLimit is 300s and backend completes at ~200s', async () => {
    let runIdReturned = false
    let pollCount = 0

    const fetchWithAuth = vi.fn(async (url: string) => {
      // First call: POST /api/solver/run -> returns run_id
      if (!runIdReturned) {
        runIdReturned = true
        return jsonResponse({ run_id: 'run-toc-1' })
      }
      // Subsequent calls: GET /api/solver/run/<id> -> pending until 200th poll
      expect(url).toContain('/api/solver/run/run-toc-1')
      pollCount += 1
      if (pollCount < 200) return pendingResponse()
      return completedResponse()
    })

    const promise = solverService.runSolver(TEST_SESSION_ID, 2026, null, fetchWithAuth, 300)
    await advancePolls(205)
    const result = await promise

    expect(result.status).toBe('completed')
    expect(pollCount).toBeGreaterThanOrEqual(200)
  })

  it('still throws when backend hangs longer than timeLimit + POLL_BUFFER_SECONDS', async () => {
    let runIdReturned = false

    const fetchWithAuth = vi.fn(async () => {
      if (!runIdReturned) {
        runIdReturned = true
        return jsonResponse({ run_id: 'run-hang' })
      }
      return pendingResponse()
    })

    const timeLimit = 30
    const promise = solverService.runSolver(TEST_SESSION_ID, 2026, null, fetchWithAuth, timeLimit)
    // Attach the rejection assertion before advancing timers so we don't race
    // the pre-emptive `.catch` suppressor against the assertion.
    const rejection = expect(promise).rejects.toThrow(/timeout/i)

    // Advance well past timeLimit + buffer to guarantee the throw fires.
    await advancePolls(timeLimit + POLL_BUFFER_SECONDS + 10)

    await rejection
  })
})

describe('solverService.pollSolverStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns immediately when first poll already shows completed', async () => {
    const fetchWithAuth = vi.fn(async () => completedResponse())

    const result = await solverService.pollSolverStatus('run-1', fetchWithAuth, 300)

    expect(result.status).toBe('completed')
    expect(fetchWithAuth).toHaveBeenCalledTimes(1)
  })
})

describe('pollSolverStatus diagnostics (#1638)', () => {
  it('returns a failed run carrying structured diagnostics instead of throwing', async () => {
    const failedBody = {
      status: 'failed',
      session_id: '1000001',
      error_message: 'Solver failed to find a solution',
      infeasibility_cause: 'The parent_paramount constraint is causing infeasibility',
      localization: {
        approach: 'singleton',
        candidate_count: 2,
        campers: [{ cm_id: 1000001, name: 'Emma Johnson', grade: 5, gender: 'F' }],
        notes: 'x',
      },
      impossibility_report: { total_impossible: 0, affected_campers: 0, flat: [] },
    }
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => failedBody,
    })

    const run = await solverService.pollSolverStatus('run-1', fetchWithAuth, 60)

    expect(run.status).toBe('failed')
    expect(run.error_message).toBe('Solver failed to find a solution')
    expect(run.diagnostics?.infeasibilityCause).toContain('parent_paramount')
    expect(run.diagnostics?.localization?.campers[0]?.name).toBe('Emma Johnson')
    expect(run.diagnostics?.impossibilityReport?.total_impossible).toBe(0)
  })
})
