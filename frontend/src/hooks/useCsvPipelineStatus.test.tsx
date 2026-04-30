import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCsvPipelineStatus, pollIntervalForPhase } from './useCsvPipelineStatus'
import { CSV_UPLOAD_STORAGE_KEY } from '../services/csvPipelineStatus'

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
  // The global setup file mocks localStorage with vi.fn() that returns undefined.
  // Override with a functional in-memory store for this suite so the CSV upload
  // marker round-trips correctly.
  const store = new Map<string, string>()
  vi.mocked(localStorage.getItem).mockImplementation((k: string) => store.get(k) ?? null)
  vi.mocked(localStorage.setItem).mockImplementation((k: string, v: string) => {
    store.set(k, v)
  })
  vi.mocked(localStorage.removeItem).mockImplementation((k: string) => {
    store.delete(k)
  })
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

  it('returns importing phase when bunk_requests is running and CSV upload context exists', async () => {
    const startedAt = new Date().toISOString()
    localStorage.setItem(CSV_UPLOAD_STORAGE_KEY, startedAt)
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

  it('returns idle when bunk_requests is running but no CSV upload context (cron)', async () => {
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
    await waitFor(() => expect(result.current.data?.phase).toBe('idle'))
  })

  it('returns done phase with mapped counts when fresh debug row exists and CSV context present', async () => {
    const startedAt = new Date(Date.now() - 5 * 60_000).toISOString()
    const finishedAt = new Date(Date.now() - 3 * 60_000).toISOString()
    const debugCreated = new Date(Date.now() - 1 * 60_000).toISOString()
    localStorage.setItem(CSV_UPLOAD_STORAGE_KEY, startedAt)
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

  it('still derives phase from sync when debug fetch fails (with CSV context)', async () => {
    const startedAt = new Date(Date.now() - 5 * 60_000).toISOString()
    const finishedAt = new Date(Date.now() - 3 * 60_000).toISOString()
    localStorage.setItem(CSV_UPLOAD_STORAGE_KEY, startedAt)
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
    ['idle (no marker)', 'idle', false],
    ['importing', 'importing', 2000],
    ['matching', 'matching', 2000],
    ['done (marker irrelevant)', 'done', false],
    ['error (marker irrelevant)', 'error', false],
  ] as const)('pollIntervalForPhase(%s) returns %s', (_label, phase, expected) => {
    expect(pollIntervalForPhase(phase)).toBe(expected)
  })

  describe('pollIntervalForPhase with CSV upload marker', () => {
    it('polls actively when phase is idle and a recent upload marker is present (sync not yet started)', () => {
      localStorage.setItem(CSV_UPLOAD_STORAGE_KEY, new Date().toISOString())
      expect(pollIntervalForPhase('idle')).toBe(2000)
    })

    it('continues polling between 5 and 10 minutes after upload (poll window matches proximity window)', () => {
      // 7 min old marker — outside the old 5-min POST_UPLOAD_POLL_WINDOW_MS but
      // inside the 10-min CSV_UPLOAD_PROXIMITY_MS. Polling should still be active
      // so we don't miss a slow-starting backend sync that derivePhase would
      // still attribute correctly.
      const marker = new Date(Date.now() - 7 * 60_000).toISOString()
      localStorage.setItem(CSV_UPLOAD_STORAGE_KEY, marker)
      expect(pollIntervalForPhase('idle')).toBe(2000)
    })

    it('stops polling once the upload marker exceeds the proximity window', () => {
      const marker = new Date(Date.now() - 11 * 60_000).toISOString()
      localStorage.setItem(CSV_UPLOAD_STORAGE_KEY, marker)
      expect(pollIntervalForPhase('idle')).toBe(false)
    })

    it('does not poll on done even with a recent marker (avoids wasted polling after success)', () => {
      localStorage.setItem(CSV_UPLOAD_STORAGE_KEY, new Date().toISOString())
      expect(pollIntervalForPhase('done')).toBe(false)
    })

    it('does not poll on error even with a recent marker', () => {
      localStorage.setItem(CSV_UPLOAD_STORAGE_KEY, new Date().toISOString())
      expect(pollIntervalForPhase('error')).toBe(false)
    })
  })
})
