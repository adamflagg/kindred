/**
 * The push write-ins modal's shell, report screen, and push/unpush
 * execution (kindred#2477 Tasks 8/10).
 *
 * The deck (stage 'deck', Task 9) is not exercised here. This file pins the
 * report screen's four class tiles and CTAs (Task 8's original describe
 * block, unchanged below) plus Task 10's push mutation, 409-stale recovery,
 * and the success screen's Unpush.
 *
 * `executeWriteInPush`/`unpushWriteIns` are spied via a partial `vi.mock` of
 * `services/lodgingApi` (real `fetchPushPreview`, `LodgingApiError`, etc. —
 * only the two write calls are replaced), and
 * `invalidateLodgingRegistryQueries` the same way via `utils/queryKeys`, so
 * the invalidation assertion is a real spy on the real helper the module
 * doc says to use rather than a hand-rolled key list.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LodgingApiError,
  type PushPreview,
  type PushResult,
  type PushRowPayload,
} from '../../services/lodgingApi'
import { PushWriteInsModal } from './PushWriteInsModal'

const mockFetchWithAuth = vi.fn()
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetchWithAuth,
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const mockExecuteWriteInPush = vi.fn()
const mockUnpushWriteIns = vi.fn()
vi.mock('../../services/lodgingApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/lodgingApi')>()
  return {
    ...actual,
    executeWriteInPush: (...args: unknown[]) => mockExecuteWriteInPush(...args) as unknown,
    unpushWriteIns: (...args: unknown[]) => mockUnpushWriteIns(...args) as unknown,
  }
})

const mockInvalidateLodgingRegistryQueries = vi.fn()
vi.mock('../../utils/queryKeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/queryKeys')>()
  return {
    ...actual,
    invalidateLodgingRegistryQueries: (...args: unknown[]) =>
      mockInvalidateLodgingRegistryQueries(...args),
  }
})

function ok(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) }
}

function row(
  unitCode: string,
  occupantName: string,
  overrides: Partial<PushRowPayload> = {}
): PushRowPayload {
  return {
    unit_id: `u-${unitCode}`,
    unit_code: unitCode,
    unit_name: unitCode,
    occupant_name: occupantName,
    note: '',
    party_size: null,
    sleeps: null,
    ...overrides,
  }
}

const PREVIEW: PushPreview = {
  year: 2026,
  session_cm_id: 1309001,
  scenario: 'scn_1',
  digest: 'd'.repeat(64),
  buildings: [
    {
      key: 'yurt-5',
      label: 'Yurt 5',
      cls: 'add',
      live: [],
      draft: [row('yurt-5', 'Kitchen crew')],
    },
    {
      key: 'fern-1',
      label: 'Fern 1',
      cls: 'match',
      live: [row('fern-1', 'E. Sandoval')],
      draft: [row('fern-1', 'E. Sandoval')],
    },
    {
      key: 'cedar-9',
      label: 'Cedar 9',
      cls: 'conflict',
      live: [row('cedar-9', 'G. Whitfield')],
      draft: [row('cedar-9', 'H. Osei')],
    },
    {
      key: 'aspen-5',
      label: 'Aspen 5',
      cls: 'remove',
      live: [row('aspen-5', 'F. Moreau')],
      draft: [],
    },
  ],
}

function renderModal(preview: PushPreview) {
  mockFetchWithAuth.mockResolvedValue(ok(preview))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PushWriteInsModal
        year={2026}
        sessionCmId={1309001}
        scenario="scn_1"
        isOpen={true}
        onClose={() => undefined}
      />
    </QueryClientProvider>
  )
}

/**
 * Mirrors `utils/queryClient.ts`'s real app defaults (30 min staleTime) —
 * the bare `retry: false` client every other test in this file uses starts
 * every query at TanStack Query's own default `staleTime: 0`, which can
 * never reproduce a bug that only exists because this app's real client
 * opts every query into a 30-minute stale window by default.
 */
function renderModalWithAppDefaults(isOpen: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30 * 60 * 1000 } },
  })
  const utils = render(
    <QueryClientProvider client={client}>
      <PushWriteInsModal
        year={2026}
        sessionCmId={1309001}
        scenario="scn_1"
        isOpen={isOpen}
        onClose={() => undefined}
      />
    </QueryClientProvider>
  )
  return { ...utils, client }
}

beforeEach(() => {
  mockFetchWithAuth.mockReset()
  mockExecuteWriteInPush.mockReset()
  mockUnpushWriteIns.mockReset()
  mockInvalidateLodgingRegistryQueries.mockReset()
})

/** A decision-free preview — one `add` building, straight to a push button
 * with no deck detour — so the push-execution tests below aren't also
 * exercising the deck (Task 9's file covers that). */
const ADD_ONLY_PREVIEW: PushPreview = {
  ...PREVIEW,
  buildings: PREVIEW.buildings.filter((b) => b.cls === 'add'),
}

const PUSH_RESULT: PushResult = {
  push_id: 'push_123',
  added: 1,
  removed: 0,
  replaced: 0,
  kept: 0,
  matched: 0,
  no_op: false,
}

describe('PushWriteInsModal — report screen', () => {
  it('report shows the four class counts and queues only decisions', async () => {
    renderModal(PREVIEW)

    expect(await screen.findByText('Will add')).toBeInTheDocument()
    // counts: 1 add, 1 match, 1 conflict, 1 remove
    expect(screen.getByRole('button', { name: /review 2 decisions/i })).toBeInTheDocument()
  })

  it('zero decisions goes straight to a push button', async () => {
    renderModal({ ...PREVIEW, buildings: PREVIEW.buildings.filter((b) => b.cls === 'add') })

    expect(await screen.findByRole('button', { name: /push 1 write-in/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /review/i })).not.toBeInTheDocument()
  })

  // kindred#2477 final review, Important #3: the modal STAYS MOUNTED across
  // opens (LodgingBoard renders it unconditionally, gated only by `isOpen`),
  // so `refetchOnMount: 'always'` never re-fires on reopen — there is no new
  // mount, only `enabled` flipping true again on an observer that already
  // exists. Under the app's real 30-minute staleTime default, that leaves a
  // reopen serving the cache from the FIRST open until the digest 409 bounces
  // a stale push — exactly the report this screen exists to keep current.
  it("reopening under the app default staleTime still shows a fresh report, not the first open's cache", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(ok(ADD_ONLY_PREVIEW))
    const { rerender, client } = renderModalWithAppDefaults(true)

    expect(await screen.findByRole('button', { name: /push 1 write-in/i })).toBeInTheDocument()

    // Close. The component does not unmount (matches how LodgingBoard
    // actually renders it) — only `isOpen` flips.
    rerender(
      <QueryClientProvider client={client}>
        <PushWriteInsModal
          year={2026}
          sessionCmId={1309001}
          scenario="scn_1"
          isOpen={false}
          onClose={() => undefined}
        />
      </QueryClientProvider>
    )

    // The board or the scenario moved while the modal was closed — the next
    // preview fetch would report a DIFFERENT decision count.
    mockFetchWithAuth.mockResolvedValueOnce(ok(PREVIEW))

    // Reopen.
    rerender(
      <QueryClientProvider client={client}>
        <PushWriteInsModal
          year={2026}
          sessionCmId={1309001}
          scenario="scn_1"
          isOpen={true}
          onClose={() => undefined}
        />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('button', { name: /review 2 decisions/i })).toBeInTheDocument()
  })
})

describe('PushWriteInsModal — push execution (Task 10)', () => {
  it('push sends digest + decisions and invalidates on success', async () => {
    const user = userEvent.setup()
    mockExecuteWriteInPush.mockResolvedValue(PUSH_RESULT)
    renderModal(ADD_ONLY_PREVIEW)

    await user.click(await screen.findByRole('button', { name: /push 1 write-in/i }))

    await waitFor(() => {
      expect(mockExecuteWriteInPush).toHaveBeenCalledTimes(1)
    })
    expect(mockExecuteWriteInPush).toHaveBeenCalledWith(mockFetchWithAuth, {
      year: 2026,
      sessionCmId: 1309001,
      scenario: 'scn_1',
      digest: ADD_ONLY_PREVIEW.digest,
      decisions: {},
    })
    // Success screen — the applied summary.
    expect(await screen.findByText('Added')).toBeInTheDocument()
    expect(mockInvalidateLodgingRegistryQueries).toHaveBeenCalledTimes(1)
  })

  it('a no-op push result renders the matches-already message, not a summary grid', async () => {
    const user = userEvent.setup()
    mockExecuteWriteInPush.mockResolvedValue({ ...PUSH_RESULT, push_id: '', added: 0, no_op: true })
    renderModal(ADD_ONLY_PREVIEW)

    await user.click(await screen.findByRole('button', { name: /push 1 write-in/i }))

    expect(
      await screen.findByText(/nothing to push.*every write-in already matches/i)
    ).toBeInTheDocument()
    expect(screen.queryByText('Added')).not.toBeInTheDocument()
  })

  it('a 409 stale response re-renders the report, not an error toast', async () => {
    const user = userEvent.setup()
    const toastModule = await import('react-hot-toast')
    const FRESH_PREVIEW: PushPreview = { ...PREVIEW, digest: 'f'.repeat(64) }
    mockExecuteWriteInPush.mockRejectedValue(
      new LodgingApiError('Failed to push write-ins (HTTP 409)', 409, {
        reason: 'stale',
        report: FRESH_PREVIEW,
      })
    )
    renderModal(ADD_ONLY_PREVIEW)

    await user.click(await screen.findByRole('button', { name: /push 1 write-in/i }))

    // FRESH_PREVIEW carries the full 4-building set (2 decisions needed),
    // unlike ADD_ONLY_PREVIEW's single add-only building — so the CTA
    // flipping from "Push 1 write-in" to "Review 2 decisions" is what proves
    // the rendered report came from the fresh report, not the stale one.
    expect(await screen.findByRole('button', { name: /review 2 decisions/i })).toBeInTheDocument()
    expect(screen.getByText(/the board changed while you were reviewing/i)).toBeInTheDocument()
    expect(toastModule.default.error).not.toHaveBeenCalled()
  })

  it('success screen offers Unpush and it invalidates too', async () => {
    const user = userEvent.setup()
    mockExecuteWriteInPush.mockResolvedValue(PUSH_RESULT)
    mockUnpushWriteIns.mockResolvedValue({ push_id: PUSH_RESULT.push_id, restored: 1, deleted: 0 })
    renderModal(ADD_ONLY_PREVIEW)

    await user.click(await screen.findByRole('button', { name: /push 1 write-in/i }))
    await user.click(await screen.findByRole('button', { name: /unpush/i }))

    await waitFor(() => {
      expect(mockUnpushWriteIns).toHaveBeenCalledTimes(1)
    })
    expect(mockUnpushWriteIns).toHaveBeenCalledWith(mockFetchWithAuth, {
      pushId: PUSH_RESULT.push_id,
      year: 2026,
      sessionCmId: 1309001,
    })
    expect(await screen.findByText(/restored 1, deleted 0/i)).toBeInTheDocument()
    expect(mockInvalidateLodgingRegistryQueries).toHaveBeenCalledTimes(2)
  })
})
