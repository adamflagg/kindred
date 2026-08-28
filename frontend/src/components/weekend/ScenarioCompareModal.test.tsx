/**
 * The scenario-vs-CampMinder compare modal (kindred#2478 §5).
 *
 * What is pinned here is what the ruling actually decided: the count split
 * (§5.4), the differing-families list with matches behind a disclosure, the
 * write-in section arriving verbatim from `preview_push`, the footer naming
 * the mirror and its age, and — the one that is easiest to lose later —
 * that the screen carries NO action of any kind (§5.6).
 *
 * Fictional families and invented unit names throughout
 * (scripts/dev/verify-no-hardcoded-lodging.sh scans tests too).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScenarioCompare } from '../../types/lodging'
import { ScenarioCompareModal } from './ScenarioCompareModal'

const mockFetchWithAuth = vi.fn()
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetchWithAuth,
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))

const mockSyncStatus = vi.fn()
vi.mock('../../hooks/useSyncStatusAPI', () => ({
  useSyncStatusAPI: () => mockSyncStatus() as unknown,
}))

function ok(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) }
}

const COMPARE: ScenarioCompare = {
  year: 2026,
  session_cm_id: 1309001,
  scenario: 'scn_1',
  session_name: 'Family Weekend One',
  counts: { match: 2, both_unassigned: 1, conflict: 1, add: 1, remove: 1 },
  parties: [
    {
      grain: 'household',
      household_cm_id: 101,
      person_cm_id: 0,
      display_name: 'The Johnson Family',
      cls: 'match',
      both_unassigned: false,
      scenario_unit_label: 'Alpha 1',
      scenario_unit_codes: ['alpha-1'],
      mirror_unit_label: 'Alpha 1',
      mirror_unit_codes: ['alpha-1'],
    },
    {
      grain: 'household',
      household_cm_id: 102,
      person_cm_id: 0,
      display_name: 'The Garcia Family',
      cls: 'match',
      both_unassigned: false,
      scenario_unit_label: 'Alpha 2',
      scenario_unit_codes: ['alpha-2'],
      mirror_unit_label: 'Alpha 2',
      mirror_unit_codes: ['alpha-2'],
    },
    {
      grain: 'household',
      household_cm_id: 103,
      person_cm_id: 0,
      display_name: 'The Chen Family',
      cls: 'match',
      both_unassigned: true,
      scenario_unit_label: '',
      scenario_unit_codes: [],
      mirror_unit_label: '',
      mirror_unit_codes: [],
    },
    {
      grain: 'household',
      household_cm_id: 104,
      person_cm_id: 0,
      display_name: 'The Okafor Family',
      cls: 'conflict',
      both_unassigned: false,
      scenario_unit_label: 'Beta 1 + Beta 2',
      scenario_unit_codes: ['beta-1', 'beta-2'],
      mirror_unit_label: 'Beta 1',
      mirror_unit_codes: ['beta-1'],
    },
    {
      grain: 'household',
      household_cm_id: 105,
      person_cm_id: 0,
      display_name: 'The Novak Family',
      cls: 'add',
      both_unassigned: false,
      scenario_unit_label: 'Beta 3',
      scenario_unit_codes: ['beta-3'],
      mirror_unit_label: '',
      mirror_unit_codes: [],
    },
    {
      grain: 'household',
      household_cm_id: 106,
      person_cm_id: 0,
      display_name: 'The Ferraro Family',
      cls: 'remove',
      both_unassigned: false,
      scenario_unit_label: '',
      scenario_unit_codes: [],
      mirror_unit_label: 'Alpha 3',
      mirror_unit_codes: ['alpha-3'],
    },
  ],
  write_ins: [
    { key: 'gamma-1', label: 'Gamma 1', cls: 'add', live: [], draft: [] },
    { key: 'gamma-2', label: 'Gamma 2', cls: 'match', live: [], draft: [] },
  ],
}

/** The differing rows as text, indexed rather than element-indexed —
 * `noUncheckedIndexedAccess` makes `rows[0]` an `HTMLElement | undefined`, and
 * the assertions here are about what each row SAYS anyway. */
async function differenceRows(): Promise<string[]> {
  const rows = await screen.findAllByTestId('compare-difference-row')
  return rows.map((row) => row.textContent)
}

function renderModal(compare: ScenarioCompare = COMPARE) {
  mockFetchWithAuth.mockResolvedValue(ok(compare))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ScenarioCompareModal
        year={2026}
        sessionCmId={1309001}
        scenario="scn_1"
        isOpen
        onClose={vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe('ScenarioCompareModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncStatus.mockReturnValue({
      data: { lodging_assignments: { status: 'success', end_time: new Date().toISOString() } },
    })
  })

  it('counts both-unassigned apart from a placed match', async () => {
    // §5.4. 54 matches that are 37 placed-identically plus 17 both-unassigned
    // are two different kinds of agreement, and one green number over the
    // pair hides a scenario nobody has worked.
    renderModal()
    const same = await screen.findByTestId('compare-tile-match')
    expect(within(same).getByText('2')).toBeInTheDocument()
    const unassigned = screen.getByTestId('compare-tile-both_unassigned')
    expect(within(unassigned).getByText('1')).toBeInTheDocument()
    expect(within(same).queryByText('3')).not.toBeInTheDocument()
  })

  it('shows the four remaining verdict counts', async () => {
    renderModal()
    for (const [cls, value] of [
      ['conflict', '1'],
      ['add', '1'],
      ['remove', '1'],
    ] as const) {
      const tile = await screen.findByTestId(`compare-tile-${cls}`)
      expect(within(tile).getByText(value)).toBeInTheDocument()
    }
  })

  it('lists one row per differing family, scenario first then CampMinder', async () => {
    // Three differing families out of six enrolled, and each row reads
    // scenario -> CampMinder in that order (§5.4).
    renderModal()
    const rows = await differenceRows()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatch(/^The Okafor FamilyBeta 1 \+ Beta 2.*Beta 1/)
  })

  it('renders a multi-room difference as a difference, not a match', async () => {
    // Owner ruling §5.2: the comparison is on the exact unit set. `Beta 1 +
    // Beta 2` against `Beta 1` is a conflict, and the row must say so.
    renderModal()
    const rows = await differenceRows()
    const okafor = rows.find((text) => text.includes('The Okafor Family'))
    expect(okafor).toMatch(/different cabin/i)
  })

  it('keeps the matching families behind a disclosure', async () => {
    renderModal()
    await screen.findAllByTestId('compare-difference-row')
    expect(screen.queryByText('The Johnson Family')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /3 matching famil/i }))
    expect(screen.getByText('The Johnson Family')).toBeInTheDocument()
    expect(screen.getByText('The Chen Family')).toBeInTheDocument()
  })

  it('renders the write-in section from the preview_push classification', async () => {
    renderModal()
    const writeIns = await screen.findByTestId('compare-write-ins')
    expect(within(writeIns).getByText('Gamma 1')).toBeInTheDocument()
    expect(within(writeIns).getByText('Gamma 2')).toBeInTheDocument()
  })

  it('names the mirror and its age in the footer', async () => {
    // §5.4's honesty requirement: without the age statement staff read a
    // stale diff as a live one.
    renderModal()
    const footer = await screen.findByTestId('compare-footer')
    expect(footer).toHaveTextContent(/CampMinder mirror/i)
    expect(footer).toHaveTextContent(/less than a minute ago/i)
  })

  it('says the mirror age is unknown rather than implying freshness', async () => {
    mockSyncStatus.mockReturnValue({ data: null })
    renderModal()
    const footer = await screen.findByTestId('compare-footer')
    expect(footer).toHaveTextContent(/CampMinder mirror/i)
    expect(footer).toHaveTextContent(/unknown/i)
  })

  it('offers no action on any row — it reports and nothing more', async () => {
    // §5.6, and the assertion most worth keeping: acting on `remove` would
    // mean writing TOWARD the mirror, which lodging_write_service.py forbids
    // outright. The only controls this screen may carry are the disclosure
    // and the modal's own close.
    renderModal()
    await screen.findAllByTestId('compare-difference-row')
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent + (b.getAttribute('aria-label') ?? ''))
    expect(labels.join(' | ')).not.toMatch(/take|keep|apply|push|accept|overwrite|revert/i)
  })

  it('asks the server again on every open rather than serving the first answer', async () => {
    // The modal stays mounted across opens (`ui/Modal`'s exit fade needs
    // that), so the app's 30-minute default would keep showing the first
    // open's comparison. Same divergence, and same reason, as
    // PushWriteInsModal's.
    mockFetchWithAuth.mockResolvedValue(ok(COMPARE))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <ScenarioCompareModal
          year={2026}
          sessionCmId={1309001}
          scenario="scn_1"
          isOpen
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    )
    await screen.findAllByTestId('compare-difference-row')
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1)

    view.rerender(
      <QueryClientProvider client={client}>
        <ScenarioCompareModal
          year={2026}
          sessionCmId={1309001}
          scenario="scn_1"
          isOpen={false}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    )
    view.rerender(
      <QueryClientProvider client={client}>
        <ScenarioCompareModal
          year={2026}
          sessionCmId={1309001}
          scenario="scn_1"
          isOpen
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    )
    await waitFor(() => {
      expect(mockFetchWithAuth).toHaveBeenCalledTimes(2)
    })
  })

  it('says so plainly when every family agrees', async () => {
    renderModal({
      ...COMPARE,
      counts: { match: 2, both_unassigned: 1, conflict: 0, add: 0, remove: 0 },
      parties: (COMPARE.parties ?? []).filter((p) => p.cls === 'match'),
      write_ins: [],
    })
    expect(await screen.findByText(/every family is in the same place/i)).toBeInTheDocument()
    expect(screen.queryAllByTestId('compare-difference-row')).toHaveLength(0)
  })

  it('keys two unresolved households apart instead of collapsing them', async () => {
    // 🚨 §5.5's landmine, reaching the screen: the roster service emits
    // `household_cm_id = 0` for a household whose record failed to resolve.
    // Keyed on the id alone React reconciles both into one row and one
    // family is shown the other's cabin.
    renderModal({
      ...COMPARE,
      counts: { match: 0, both_unassigned: 0, conflict: 0, add: 1, remove: 1 },
      parties: [
        {
          grain: 'household',
          household_cm_id: 0,
          person_cm_id: 0,
          display_name: 'The Vasquez Family',
          cls: 'add',
          both_unassigned: false,
          scenario_unit_label: 'Alpha 1',
          scenario_unit_codes: ['alpha-1'],
          mirror_unit_label: '',
          mirror_unit_codes: [],
        },
        {
          grain: 'household',
          household_cm_id: 0,
          person_cm_id: 0,
          display_name: 'The Lindqvist Family',
          cls: 'remove',
          both_unassigned: false,
          scenario_unit_label: '',
          scenario_unit_codes: [],
          mirror_unit_label: 'Beta 1',
          mirror_unit_codes: ['beta-1'],
        },
      ],
      write_ins: [],
    })
    // React renders duplicate-keyed siblings on a first mount and only WARNS,
    // so counting rows cannot catch this — the warning is the observable.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rows = await differenceRows()
    expect(rows).toHaveLength(2)
    expect(rows.join(' | ')).toContain('The Vasquez Family')
    expect(rows.join(' | ')).toContain('The Lindqvist Family')
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/two children with the same key/i)
    consoleError.mockRestore()
  })
})
