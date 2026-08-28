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
import { queryKeys } from '../../utils/queryKeys'
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
  const utils = render(
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
  return { ...utils, client }
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

  // Owner ruling 2026-08-24 (visual round 2, item 5): the "Will add" and "Not
  // in scenario" tiles must name the occupant, not just list the building —
  // staff approving an add or a removal need to see WHO, not just WHERE.
  it('the "Will add" tile names the occupant, not just the building', async () => {
    renderModal(PREVIEW)
    expect(await screen.findByText(/Kitchen crew — Yurt 5/)).toBeInTheDocument()
  })

  it('the "Not in scenario" tile names the occupant being removed', async () => {
    renderModal(PREVIEW)
    expect(await screen.findByText(/F\. Moreau — Aspen 5/)).toBeInTheDocument()
  })

  // Owner ruling 2026-08-24 (visual round 2, item 2): "live" is banned from
  // staff-facing copy — staff think of the live board as "CampMinder".
  it('an empty report speaks CampMinder, not "the live board"', async () => {
    renderModal({ ...PREVIEW, buildings: [] })
    expect(await screen.findByText(/already match campminder/i)).toBeInTheDocument()
  })

  // kindred#2477 final review, Important #6: `execute_push`'s `match` branch
  // only increments `matched` -- it extends neither `adds` nor `removes`, so
  // a match writes NOTHING. The CTA count must reflect that: only an `add`
  // building's draft rows are ever written by a decision-free push. Fixture:
  // one `add` building with TWO draft rows plus one `match` building with
  // one draft row -- summing everyone's draft (the old bug) reads "3"; only
  // counting `add` reads "2".
  it('the push CTA counts only add-class rows, not matches', async () => {
    const preview: PushPreview = {
      ...PREVIEW,
      buildings: [
        {
          key: 'yurt-5',
          label: 'Yurt 5',
          cls: 'add',
          live: [],
          draft: [row('yurt-5', 'Kitchen crew'), row('yurt-5', 'Second write-in')],
        },
        {
          key: 'fern-1',
          label: 'Fern 1',
          cls: 'match',
          live: [row('fern-1', 'E. Sandoval')],
          draft: [row('fern-1', 'E. Sandoval')],
        },
      ],
    }
    renderModal(preview)

    expect(await screen.findByRole('button', { name: /push 2 write-ins/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /push 3 write-ins/i })).not.toBeInTheDocument()
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

  // Owner ruling 2026-08-24 (visual round 2, item 5): under the added/removed
  // counts, the success screen must list WHO was added and WHO was removed.
  it('success screen names who was added and who was removed', async () => {
    const user = userEvent.setup()
    mockExecuteWriteInPush.mockResolvedValue({
      push_id: 'push_456',
      added: 1,
      removed: 1,
      replaced: 0,
      kept: 0,
      matched: 0,
      no_op: false,
    })
    const addAndRemove = PREVIEW.buildings.filter((b) => b.cls === 'add' || b.cls === 'remove')
    renderModal({ ...PREVIEW, buildings: addAndRemove })

    // aspen-5 (remove) arrives pre-decided to 'remove' — the actionable
    // default (owner ruling 2026-08-24, item 6) — so Push is already enabled
    // once the deck is reached.
    await user.click(await screen.findByRole('button', { name: /review 1 decision/i }))
    await user.click(screen.getByRole('button', { name: 'Push' }))

    expect(await screen.findByText('Added')).toBeInTheDocument()
    expect(screen.getByText('Kitchen crew')).toBeInTheDocument()
    expect(screen.getByText('F. Moreau')).toBeInTheDocument()
  })

  // The push's own `invalidateLodgingRegistryQueries` now reaches the
  // push-preview key too (owner ruling 2026-08-28: the board's badge reads
  // that key and must drop to 0 the moment a push lands). That refetch
  // replaces `query.data` with a report in which nothing is left to push —
  // so the success screen cannot name its occupants off the CURRENT preview,
  // which is what it used to do while the key was never invalidated.
  it('the success screen keeps naming the pushed occupants after the preview refetches', async () => {
    const user = userEvent.setup()
    mockExecuteWriteInPush.mockResolvedValue({
      push_id: 'push_789',
      added: 1,
      removed: 1,
      replaced: 0,
      kept: 0,
      matched: 0,
      no_op: false,
    })
    const addAndRemove = PREVIEW.buildings.filter((b) => b.cls === 'add' || b.cls === 'remove')
    const { client } = renderModal({ ...PREVIEW, buildings: addAndRemove })

    await user.click(await screen.findByRole('button', { name: /review 1 decision/i }))
    await user.click(screen.getByRole('button', { name: 'Push' }))
    expect(await screen.findByText('Kitchen crew')).toBeInTheDocument()

    // What the server would now report: the push landed, everything matches.
    mockFetchWithAuth.mockResolvedValue(ok({ ...PREVIEW, buildings: [], digest: 'e'.repeat(64) }))
    void client.invalidateQueries({ queryKey: queryKeys.pushPreviewPrefix() })

    // Waits for the refetched report to actually land in the cache — a call
    // count would go up the instant the fetch STARTS, well before the data
    // this test is about reaches the component.
    await waitFor(() => {
      expect(client.getQueryData(queryKeys.pushPreview(2026, 1309001, 'scn_1'))).toMatchObject({
        digest: 'e'.repeat(64),
      })
    })
    expect(screen.getByText('Kitchen crew')).toBeInTheDocument()
    expect(screen.getByText('F. Moreau')).toBeInTheDocument()
  })
})

// REWRITTEN — owner ruling 2026-08-24 (visual round 2, item 6): "Push stays
// disabled until every decision is made" described a spec this modal no
// longer implements. Decisions now arrive pre-populated to the actionable
// side (every `conflict` defaults to 'scenario', every `remove` defaults to
// 'remove') the instant the preview loads, so by the time staff reaches the
// deck every building already has a decision and Push is enabled from the
// start. D33's block rule is untouched — it is still wired
// (`pushDisabled={deckBuildings.length > decidedCount || ...}`) and still
// enforced by the server's 422 completeness check — but it now functions as
// a defensive belt rather than a state staff routinely sees, which is why
// PushDecisionDeck.test.tsx's own rewritten test proves the belt directly
// via props instead of here. This block instead pins the new default state,
// that staff can still override it, and that overriding both ways works.
describe('PushWriteInsModal — deck stage defaults are actionable (owner ruling 2026-08-24)', () => {
  it('decisions arrive pre-populated to the actionable side and Push is enabled immediately', async () => {
    const user = userEvent.setup()
    renderModal(PREVIEW) // 2 decisions needed: cedar-9 (conflict), aspen-5 (remove)

    await user.click(await screen.findByRole('button', { name: /review 2 decisions/i }))

    // No clicks yet — both buildings already carry a default decision.
    expect(screen.getByText('2 / 2 decided')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push' })).toBeEnabled()

    // cedar-9 (pairwise conflict) defaults to 'scenario' — "This scenario"
    // starts picked, not "On CampMinder now".
    expect(screen.getByRole('button', { name: 'This scenario' }).className).toContain(
      'ring-primary/30'
    )
    expect(screen.getByRole('button', { name: 'On CampMinder now' }).className).not.toContain(
      'ring-primary/30'
    )

    // aspen-5 (remove) defaults to 'remove' — "Remove from CampMinder"
    // starts picked, not "Leave on CampMinder".
    await user.click(screen.getByRole('button', { name: 'Next card' }))
    expect(screen.getByRole('button', { name: 'Remove from CampMinder' }).className).toContain(
      'ring-primary/30'
    )
    expect(screen.getByRole('button', { name: 'Leave on CampMinder' }).className).not.toContain(
      'ring-primary/30'
    )
  })

  it('flipping a card to "On CampMinder now" and back to "This scenario" works', async () => {
    const user = userEvent.setup()
    renderModal(PREVIEW)
    await user.click(await screen.findByRole('button', { name: /review 2 decisions/i }))

    const campminderSide = screen.getByRole('button', { name: 'On CampMinder now' })
    const scenarioSide = screen.getByRole('button', { name: 'This scenario' })

    // Starts on the default (actionable) side.
    expect(scenarioSide.className).toContain('ring-primary/30')
    expect(campminderSide.className).not.toContain('ring-primary/30')

    await user.click(campminderSide)
    expect(campminderSide.className).toContain('ring-primary/30')
    expect(scenarioSide.className).not.toContain('ring-primary/30')
    // Overriding never un-decides a building the ruled block cares about.
    expect(screen.getByText('2 / 2 decided')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push' })).toBeEnabled()

    await user.click(scenarioSide)
    expect(scenarioSide.className).toContain('ring-primary/30')
    expect(campminderSide.className).not.toContain('ring-primary/30')
  })
})

describe('PushWriteInsModal — dialog anchoring (kindred#2477 final review, Important #7)', () => {
  // spec §7 called for `anchor="top"` — this modal's three stages (report,
  // deck, done) change content height exactly the way `ui/Modal`'s own doc
  // describes as the defect `anchor="top"` exists to prevent: centred, a
  // height change re-centres the whole card and everything above the changed
  // region moves too. `AssignFamilyModal.test.tsx`'s
  // "anchors the dialog to the top" test is the pattern this mirrors.
  it('anchors the dialog to the top rather than centring it', async () => {
    renderModal(PREVIEW)
    await screen.findByText('Will add')
    const wrapper = screen.getByRole('dialog')
    expect(wrapper.className).toContain('items-start')
    expect(wrapper.className).not.toContain('items-center')
  })

  // Owner ruling 2026-08-24 (visual round 2, item 1): the modal was too
  // wide — drop `ui/Modal`'s `size` one step, `"2xl"` (max-w-6xl) to `"xl"`
  // (max-w-4xl).
  it('is one size step narrower than before ("xl", not "2xl")', async () => {
    renderModal(PREVIEW)
    await screen.findByText('Will add')
    const content = screen.getByTestId('modal-content')
    expect(content.className).toContain('max-w-4xl')
    expect(content.className).not.toContain('max-w-6xl')
  })
})
