/**
 * Board notes -- the hook-level contract: every call carries the PocketBase
 * JWT, the read is disabled without bunking.manage, and every write
 * invalidates by the subject-notes PREFIX. `useApiWithAuth` is NOT mocked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { queryKeys } from '../utils/queryKeys'
import { usePromoteSubjectNote, useSaveSubjectNote, useSubjectNotes } from './useSubjectNotes'

vi.mock('../lib/pocketbase', () => ({ pb: { authStore: { token: 'test-jwt', clear: vi.fn() } } }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
const toastError = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}))

const SUBJECT = { kind: 'person' as const, cmId: 1000101, sessionCmId: 1000001 }
let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

/** See the "sets no cache options of its own" test below. */
interface StaleTimeOptions {
  staleTime?: number
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function authHeaderOf(call: unknown[] | undefined): string | null {
  return new Headers(((call?.[1] ?? {}) as RequestInit).headers).get('Authorization')
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ notes: [] }), { status: 200 }))
    )
})

afterEach(() => {
  fetchSpy.mockRestore()
  toastError.mockReset()
})

describe('useSubjectNotes', () => {
  it('reads the board with the JWT', async () => {
    renderHook(
      () => useSubjectNotes({ year: 2026, sessionCmId: 1000001, scenario: '', enabled: true }),
      { wrapper }
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/subject-notes?session_cm_id=1000001&year=2026'
    )
    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBe('Bearer test-jwt')
  })

  it('reads nothing for a viewer without bunking.manage', async () => {
    renderHook(
      () => useSubjectNotes({ year: 2026, sessionCmId: 1000001, scenario: '', enabled: false }),
      { wrapper }
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sets no cache options of its own (inherits the app defaults)', async () => {
    renderHook(
      () => useSubjectNotes({ year: 2026, sessionCmId: 1000001, scenario: '', enabled: true }),
      { wrapper }
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const query = client
      .getQueryCache()
      .find({ queryKey: queryKeys.subjectNotes(1000001, 2026, '') })
    // `Query.options` is typed as the base `QueryOptions`, which has no
    // `staleTime` -- that lives on the observer-level `QueryObserverOptions`
    // the query was actually constructed from. The cast (through `unknown`,
    // never `any`) reads the SAME runtime object through a narrower local
    // type just to name the field tsc otherwise won't let us reach.
    const resolved = query?.options as unknown as StaleTimeOptions | undefined
    expect(resolved?.staleTime).toBeUndefined()
  })
})

describe('while a new read is in flight (owner ruling 2026-09-26)', () => {
  const standardRow = {
    subject_kind: 'household' as const,
    subject_cm_id: 2000001,
    session_cm_id: 1000001,
    scenario: '',
    body: 'Grandma comes Saturday.',
    updated_by: 'Test Staff',
    updated: '2026-09-25T12:00:00Z',
  }
  const planRowA = { ...standardRow, scenario: 'scnA', body: 'Try Pine' }
  const planRowB = { ...standardRow, scenario: 'scnB', body: 'Try Cedar' }

  it('keeps the standard rows and drops the old scenario’s plan rows while only the scenario changed', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ notes: [standardRow, planRowA] }), { status: 200 })
      )
    )
    const { result, rerender } = renderHook(
      ({ scenario }) =>
        useSubjectNotes({ year: 2026, sessionCmId: 1000001, scenario, enabled: true }),
      { wrapper, initialProps: { scenario: 'scnA' } }
    )
    await waitFor(() => expect(result.current.data).toEqual({ notes: [standardRow, planRowA] }))

    let resolveB: ((response: Response) => void) | undefined
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveB = resolve
        })
    )
    rerender({ scenario: 'scnB' })

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true))
    expect(result.current.data).toEqual({ notes: [standardRow] })

    // B's real payload deliberately differs from the placeholder (its own
    // plan row, `planRowB`, never `planRowA`'s), proving `data` equals B's
    // real payload, not only that the placeholder flag flipped off -- which
    // would pass even if `data` had silently kept showing the placeholder
    // value.
    resolveB?.(new Response(JSON.stringify({ notes: [standardRow, planRowB] }), { status: 200 }))
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false))
    expect(result.current.data).toEqual({ notes: [standardRow, planRowB] })
  })

  it('blanks (no placeholder) when the SESSION changes mid-scenario', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ notes: [standardRow] }), { status: 200 }))
    )
    const { result, rerender } = renderHook(
      ({ sessionCmId }) =>
        useSubjectNotes({ year: 2026, sessionCmId, scenario: 'scnA', enabled: true }),
      { wrapper, initialProps: { sessionCmId: 1000001 } }
    )
    await waitFor(() => expect(result.current.data).toEqual({ notes: [standardRow] }))

    fetchSpy.mockImplementationOnce(
      () =>
        new Promise(() => {
          // Deliberately never resolves -- we only assert the state WHILE pending.
        })
    )
    rerender({ sessionCmId: 1000002 })

    await waitFor(() => expect(result.current.isPending).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(result.current.isPlaceholderData).toBe(false)
  })
})

describe('the note mutations', () => {
  it('save sends the JWT and invalidates every subject-notes read', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ note: null, deleted: true }), { status: 200 }))
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useSaveSubjectNote(), { wrapper })
    await result.current.mutateAsync({ subject: SUBJECT, year: 2026, scenario: '', body: '' })
    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBe('Bearer test-jwt')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.subjectNotesPrefix() })
  })

  it('promote sends the JWT and invalidates by prefix', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ note: null, deleted: false }), { status: 200 }))
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => usePromoteSubjectNote(), { wrapper })
    await result.current.mutateAsync({ subject: SUBJECT, year: 2026, scenario: 'scnA' })
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('/api/subject-notes/promote')
    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBe('Bearer test-jwt')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.subjectNotesPrefix() })
  })

  it('a failed promote toasts the server detail', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            detail: 'Keeping this on all plans would make the note 2101 characters',
          }),
          {
            status: 422,
          }
        )
      )
    )
    const { result } = renderHook(() => usePromoteSubjectNote(), { wrapper })
    await expect(
      result.current.mutateAsync({ subject: SUBJECT, year: 2026, scenario: 'scnA' })
    ).rejects.toThrow()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('2101 characters'))
  })
})
