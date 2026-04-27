import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCsvPipelineStatus, pollIntervalForPhase } from './useCsvPipelineStatus'

vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchWithAuth: (globalThis as any).__mockFetch,
  }),
}))

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return Wrapper
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).__mockFetch = undefined
})

describe('useCsvPipelineStatus', () => {
  it('returns idle phase when both sources are empty', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).__mockFetch = vi.fn(async (url: string) => {
      if (url.includes('sync/status')) {
        return { ok: true, json: async () => ({ _daily_sync_running: false }) } as Response
      }
      return { ok: true, json: async () => ({ items: [] }) } as Response
    })
    const { result } = renderHook(() => useCsvPipelineStatus(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data?.phase).toBe('idle'))
  })

  it('returns importing phase when bunk_requests is running', async () => {
    const startedAt = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).__mockFetch = vi.fn(async (url: string) => {
      if (url.includes('sync/status')) {
        return {
          ok: true,
          json: async () => ({
            bunk_requests: { type: 'bunk_requests', status: 'running', start_time: startedAt },
          }),
        } as Response
      }
      return { ok: true, json: async () => ({ items: [] }) } as Response
    })
    const { result } = renderHook(() => useCsvPipelineStatus(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data?.phase).toBe('importing'))
  })

  it('returns done phase with mapped counts when fresh debug row exists', async () => {
    const startedAt = new Date(Date.now() - 5 * 60_000).toISOString()
    const finishedAt = new Date(Date.now() - 3 * 60_000).toISOString()
    const debugCreated = new Date(Date.now() - 1 * 60_000).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).__mockFetch = vi.fn(async (url: string) => {
      if (url.includes('sync/status')) {
        return {
          ok: true,
          json: async () => ({
            bunk_requests: {
              type: 'bunk_requests',
              status: 'completed',
              start_time: startedAt,
              end_time: finishedAt,
            },
          }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              run_id: 'r-done',
              created: debugCreated,
              status_breakdown: { status_resolved: 18, status_pending: 4, status_declined: 2 },
            },
          ],
        }),
      } as Response
    })
    const { result } = renderHook(() => useCsvPipelineStatus(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data?.phase).toBe('done'))
    expect(result.current.data).toMatchObject({
      runId: 'r-done',
      counts: { total: 24, autoMatched: 20, needReview: 4 },
    })
  })

  it('exposes errors from fetchers via React Query error state', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).__mockFetch = vi.fn(async () => ({ ok: false, status: 500 }) as Response)
    const { result } = renderHook(() => useCsvPipelineStatus(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('still derives phase from sync when debug fetch fails', async () => {
    const startedAt = new Date(Date.now() - 5 * 60_000).toISOString()
    const finishedAt = new Date(Date.now() - 3 * 60_000).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).__mockFetch = vi.fn(async (url: string) => {
      if (url.includes('sync/status')) {
        return {
          ok: true,
          json: async () => ({
            bunk_requests: {
              type: 'bunk_requests',
              status: 'completed',
              start_time: startedAt,
              end_time: finishedAt,
            },
          }),
        } as Response
      }
      return { ok: false, status: 500 } as Response
    })
    const { result } = renderHook(() => useCsvPipelineStatus(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data?.phase).toBe('matching'))
  })

  it.each([
    ['idle', false],
    ['importing', 2000],
    ['matching', 2000],
    ['done', false],
    ['error', false],
  ] as const)('pollIntervalForPhase(%s) returns %s', (phase, expected) => {
    expect(pollIntervalForPhase(phase)).toBe(expected)
  })
})
