/**
 * Tests for the run-sweep service helpers.
 *
 * Bug: postRunSweep / postCancelSweep used raw fetch with credentials:'include',
 * which silently 401s because the PocketBase JWT lives in localStorage, not as
 * a cookie. Fix: route through fetchWithAuth (which attaches Authorization:
 * Bearer <token>), matching the existing solverService.runSolver pattern.
 */
import { describe, expect, it, vi } from 'vitest'

import { postCancelSweep, postRunSweep } from './solver'

describe('postRunSweep', () => {
  it('calls fetchWithAuth so the PB JWT is attached (not raw fetch with credentials)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sweep_id: 'sw_1', run_ids: ['r1', 'r2'] }),
    } as Response)

    const result = await postRunSweep(mockFetch, {
      session_cm_id: 1000002,
      year: 2026,
      time_budgets: [30, 60],
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/solver/run-sweep')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toMatchObject({
      session_cm_id: 1000002,
      year: 2026,
      time_budgets: [30, 60],
    })
    expect(result).toEqual({ sweep_id: 'sw_1', run_ids: ['r1', 'r2'] })
  })

  it('throws on non-ok response with the status in the message when no detail body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response)

    await expect(
      postRunSweep(mockFetch, { session_cm_id: 1, year: 2026, time_budgets: [30] })
    ).rejects.toThrow(/401/)
  })

  it('surfaces FastAPI HTTPException detail when the body has one (e.g. 409 conflict)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        detail: { detail: 'Solver already running for session 1000002', in_progress_run_id: 'r_x' },
      }),
    } as Response)

    await expect(
      postRunSweep(mockFetch, { session_cm_id: 1000002, year: 2026, time_budgets: [30] })
    ).rejects.toThrow(/already running for session 1000002/)
  })
})

describe('postCancelSweep', () => {
  it('routes through fetchWithAuth and POSTs to the cancel endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response)

    await postCancelSweep(mockFetch, 'sw_42')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/solver/run-sweep/sw_42/cancel')
    expect(init.method).toBe('POST')
  })
})
