/**
 * Board notes: `SubjectNotesScope` driven with the REAL `useSubjectNotes`
 * hook, not the hand-mocked module `SubjectNotesScope.test.tsx` uses.
 *
 * M1 (PR3 follow-ups, test-only): a scenario switch A -> B shows A's standard
 * rows as a placeholder while B's own read is in flight (owner ruling
 * 2026-09-26). If B's read then FAILS, that placeholder must not linger --
 * everything hides (the scope value goes `null`) and the "Failed to load
 * notes" toast fires, exactly as a first-load failure would.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { HOUSEHOLD } from '../../test/notesScope'
import { useSubjectNotesScope } from './subjectNotesContext'
import { SubjectNotesScope } from './SubjectNotesScope'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
const toastError = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}))

const standardRow = {
  subject_kind: 'household' as const,
  subject_cm_id: HOUSEHOLD.cmId,
  session_cm_id: HOUSEHOLD.sessionCmId,
  scenario: '',
  body: 'Grandma comes Saturday.',
  updated_by: 'Test Staff',
  updated: '2026-09-25T12:00:00Z',
}

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>
// SubjectNotesScope.test.tsx's own pattern: `renderHook`'s `wrapper` never
// receives the callback's props (only `{children}`), so a scenario switch is
// driven through a captured variable the wrapper closes over, read again on
// a plain `rerender()`.
let scenarioId = 'scnA'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <SubjectNotesScope
        year={2026}
        sessionCmId={HOUSEHOLD.sessionCmId}
        scenarioId={scenarioId}
        scenarioName="Draft A"
        canManage={true}
      >
        {children}
      </SubjectNotesScope>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  scenarioId = 'scnA'
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ notes: [] }), { status: 200 }))
    )
  toastError.mockReset()
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('SubjectNotesScope, driven by the real useSubjectNotes read', () => {
  it('hides everything and toasts once, when the scenario B switched to fails its own read', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ notes: [standardRow] }), { status: 200 }))
    )
    const { result, rerender } = renderHook(() => useSubjectNotesScope(), { wrapper })

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current?.notesFor(HOUSEHOLD).standard?.body).toBe('Grandma comes Saturday.')

    let rejectB: ((error: unknown) => void) | undefined
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectB = reject
        })
    )
    scenarioId = 'scnB'
    rerender()

    // B's own read is still in flight: A's placeholder standard rows are
    // still on screen, not yet hidden.
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current?.notesFor(HOUSEHOLD).standard?.body).toBe('Grandma comes Saturday.')

    rejectB?.(new Error('the board could not be reached'))

    await waitFor(() => expect(result.current).toBeNull())
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining('could not be reached'),
      expect.objectContaining({ id: 'subject-notes-read' })
    )
  })
})
