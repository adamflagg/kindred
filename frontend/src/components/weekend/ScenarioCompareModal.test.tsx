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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompareParty, LodgingUnitRow, ScenarioCompare } from '../../types/lodging'
import { ScenarioCompareModal } from './ScenarioCompareModal'

const mockFetchWithAuth = vi.fn()
/** Flipped by the auth-gate test; every other test runs with auth settled. */
let mockIsAuthLoading = false
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetchWithAuth,
    isAuthenticated: true,
    get isAuthLoading() {
      return mockIsAuthLoading
    },
  }),
}))

const mockSyncStatus = vi.fn()
vi.mock('../../hooks/useSyncStatusAPI', () => ({
  useSyncStatusAPI: () => mockSyncStatus() as unknown,
}))

/**
 * The board's own roster payload, which the modal reads for the registry it
 * names placements from. A PLAIN MODULE VARIABLE rather than a `vi.fn()`: the
 * describe blocks below each call `vi.clearAllMocks()`, and a default set with
 * `mockReturnValue` in one block is not obviously safe from another's reset.
 * `undefined` is the resting state -- no units, so every test that predates
 * this reads the server's own labels, exactly as it did before.
 */
let mockRosterUnits: LodgingUnitRow[] | undefined
vi.mock('../../hooks/useWeekendRoster', () => ({
  useWeekendRoster: () => ({
    data: mockRosterUnits === undefined ? undefined : { units: mockRosterUnits },
  }),
}))

function unitRow(over: Partial<LodgingUnitRow> & Pick<LodgingUnitRow, 'code' | 'name'>) {
  return { unit_id: over.code, is_active: true, ...over } as LodgingUnitRow
}

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
      children: [
        { person_cm_id: 941, display_name: 'Rowan Okafor', last_name: 'Okafor', age: 9.4 },
        { person_cm_id: 942, display_name: 'Wren Okafor', last_name: 'Okafor', age: 6.1 },
      ],
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
    {
      key: 'gamma-1',
      label: 'Gamma 1',
      cls: 'add',
      live: [],
      draft: [
        {
          unit_id: 'g1',
          unit_code: 'gamma-1',
          unit_name: 'Gamma 1',
          occupant_name: 'Abara',
          note: '',
          party_size: 4,
        },
      ],
    },
    {
      key: 'gamma-2',
      label: 'Gamma 2',
      cls: 'match',
      live: [
        {
          unit_id: 'g2',
          unit_code: 'gamma-2',
          unit_name: 'Gamma 2',
          occupant_name: 'Delacroix',
          note: '',
          party_size: null,
        },
      ],
      draft: [
        {
          unit_id: 'g2',
          unit_code: 'gamma-2',
          unit_name: 'Gamma 2',
          occupant_name: 'Delacroix',
          note: '',
          party_size: null,
        },
      ],
    },
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
    // Named by its children, as the board names it — the mailing title is the
    // fallback, not the label. This assertion is about ORDER; the naming rule
    // has its own describe block below.
    expect(rows[0]).toMatch(/^Wren \(6\) · Rowan \(9\) OkaforBeta 1 \+ Beta 2.*Beta 1/)
  })

  it('renders a multi-room difference as a difference, not a match', async () => {
    // Owner ruling §5.2: the comparison is on the exact unit set. `Beta 1 +
    // Beta 2` against `Beta 1` is a conflict, and the row must say so.
    renderModal()
    const rows = await differenceRows()
    const okafor = rows.find((text) => text.includes('Rowan (9) Okafor'))
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
    // Both buildings come from the same classifier the Push Write-Ins screen
    // uses. Gamma 1 (`add`) shows at rest; Gamma 2 (`match`) sits behind the
    // disclosure, mirroring the family half — asserted in its own test below.
    renderModal()
    const writeIns = await screen.findByTestId('compare-write-ins')
    expect(within(writeIns).getByText('Gamma 1')).toBeInTheDocument()
    expect(
      within(writeIns).getByRole('button', { name: /1 matching write-in/i })
    ).toBeInTheDocument()
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

describe('ScenarioCompareModal — a family is named by its children, as the board names it', () => {
  it("leads with the children's run, not CampMinder's mailing title", async () => {
    renderModal()
    const rows = await differenceRows()
    // `childrenRun`'s own grammar, shared with FamilyCard's bold line: youngest
    // first, whole-year ages, the surname lifted out once when every child
    // shares it. Asserted through the row text so a drift in that helper is
    // caught here rather than silently rendering a second vocabulary.
    expect(rows.some((row) => row.includes('Wren (6) · Rowan (9) Okafor'))).toBe(true)
    expect(rows.some((row) => row.includes('The Okafor Family'))).toBe(false)
  })

  it('falls back to the household name for a party with no children on file', async () => {
    renderModal()
    const rows = await differenceRows()
    // The Novak Family carries no `children`, exactly as an adult-grain guest
    // would, so the mailing title is all there is to show.
    expect(rows.some((row) => row.includes('The Novak Family'))).toBe(true)
  })

  it('scrolls the family list inside the dialog, leaving the tiles and footer put', async () => {
    // A real weekend ran to a list taller than the viewport, so the OVERLAY
    // scrolled -- taking the blurred backdrop with it (`ui/Modal` fixes its
    // half). Here the body owns its overflow, which also keeps the footer's
    // "compared against the mirror, last synced X" on screen: the modal's own
    // docstring calls that line load-bearing, and a footer you have to scroll
    // to find is a footer staff do not read.
    renderModal()
    await screen.findAllByTestId('compare-difference-row')
    const region = screen.getByTestId('compare-scroll')
    expect(region.className).toMatch(/overflow-y-auto/)
    expect(region.className).toMatch(/max-h-/)
    // The tiles and the footer sit OUTSIDE it, or they scroll away too.
    expect(region.querySelector('[data-testid="compare-tile-match"]')).toBeNull()
    expect(region.querySelector('[data-testid="compare-footer"]')).toBeNull()
  })
})

describe('ScenarioCompareModal — the protected query waits for auth', () => {
  afterEach(() => {
    mockIsAuthLoading = false
  })

  it('does not fetch while AuthContext is still loading', async () => {
    // `frontend/CLAUDE.md`: "useAuth().isLoading first. Always check isLoading
    // before making authenticated API calls." `useApiWithAuth` reads
    // `pb.authStore.token` at CALL time, so a query that fires mid-restore
    // sends no Authorization header, and `/api/lodging/compare` is permission
    // -gated — the 401 handler then clears auth and bounces the user to
    // /login from a modal they just opened.
    mockIsAuthLoading = true
    mockFetchWithAuth.mockResolvedValue(ok(COMPARE))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ScenarioCompareModal
          isOpen={true}
          onClose={() => {}}
          year={2026}
          sessionCmId={1309001}
          scenario="scn_1"
        />
      </QueryClientProvider>
    )
    await Promise.resolve()
    expect(mockFetchWithAuth).not.toHaveBeenCalled()
  })
})

describe('ScenarioCompareModal — the write-in half mirrors the family half', () => {
  it('names the occupants, not just the cabin', async () => {
    // A cabin name on its own says nothing: "Gamma 1 — Only in this plan"
    // does not tell you WHO the scenario put there. The push screen already
    // pairs the two (`occupant_name — label`), so this one does too, with the
    // occupant on the left where a family row carries the family.
    renderModal()
    const rows = await screen.findAllByTestId('compare-write-in-row')
    const texts = rows.map((r) => r.textContent)
    expect(texts.some((t) => t?.includes('Abara') && t.includes('Gamma 1'))).toBe(true)
  })

  it('shows a recorded party size and stays quiet about one nobody typed', async () => {
    // `party_size: null` is "occupies wholesale, never zero" (kindred#2540), so
    // the name renders BARE — no parenthetical at all. Asserted on the absence
    // of "(" rather than of "0": the first version of this test looked for a
    // literal 0 and stayed green while the code rendered "Delacroix (null)".
    renderModal()
    const shown = await screen.findAllByTestId('compare-write-in-row')
    expect(shown.map((r) => r.textContent ?? '').some((t) => t.includes('Abara (4)'))).toBe(true)

    // Delacroix is a MATCH, so it lives behind the disclosure — checking it
    // without opening that was the second reason the first version was inert.
    await userEvent.click(screen.getByRole('button', { name: /matching write-in/i }))
    const rows = await screen.findAllByTestId('compare-write-in-row')
    const delacroix = rows.map((r) => r.textContent ?? '').find((t) => t.includes('Delacroix'))
    expect(delacroix).toBeDefined()
    expect(delacroix).not.toContain('(')
  })

  it('collapses MATCHING write-ins behind a disclosure, as matching families are', async () => {
    // Gamma 2 matches; Gamma 1 does not. Only the differing one is on screen
    // at rest — a matched write-in is agreement, and agreement is what the
    // family half already tucks away.
    renderModal()
    const rows = await screen.findAllByTestId('compare-write-in-row')
    expect(rows.map((r) => r.textContent).some((t) => t?.includes('Gamma 1'))).toBe(true)
    expect(rows.map((r) => r.textContent).some((t) => t?.includes('Gamma 2'))).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: /matching write-in/i }))
    const after = await screen.findAllByTestId('compare-write-in-row')
    expect(after.map((r) => r.textContent).some((t) => t?.includes('Gamma 2'))).toBe(true)
  })
})

describe('ScenarioCompareModal — an arrow means the two sides differ', () => {
  // This block stands on its own rather than borrowing the first describe's
  // beforeEach: a sibling block that leans on a neighbour's mock setup passes
  // in a full run and dies under `vitest -t`, which is exactly how a mutation
  // check gets a green it did not earn.
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncStatus.mockReturnValue({
      data: { lodging_assignments: { status: 'success', end_time: new Date().toISOString() } },
    })
  })

  /** `&rarr;` and `&mdash;` as the DOM actually holds them. */
  const ARROW = '→'
  const DASH = '—'

  async function matchRowSaying(fragment: string): Promise<string> {
    await screen.findAllByTestId('compare-difference-row')
    await userEvent.click(screen.getByRole('button', { name: /matching famil/i }))
    const rows = await screen.findAllByTestId('compare-match-row')
    const row = rows.map((r) => r.textContent).find((t) => t.includes(fragment))
    expect(row).toBeDefined()
    return row ?? ''
  }

  it('names a matched cabin once instead of pointing an arrow at itself', async () => {
    // Owner report: a match rendered `Alpha 1 -> Alpha 1 · Same cabin`, which
    // spends a row's width restating agreement. The two sides ARE the same
    // unit on a match -- that is what the verdict means -- so the row states
    // it once and lets the pill carry the rest.
    renderModal()
    const johnson = await matchRowSaying('The Johnson Family')
    expect((johnson.match(/Alpha 1/g) ?? []).length).toBe(1)
    expect(johnson).not.toContain(ARROW)
    expect(johnson).toContain('Same cabin')
  })

  it('still reads as Both unassigned when neither side placed the family', async () => {
    // The other half of `match` (§5.4), and the one an over-eager collapse
    // would break: there is no unit on either side, so there is nothing to
    // state once -- but the row must still SAY that agreement, not go blank.
    renderModal()
    const chen = await matchRowSaying('The Chen Family')
    expect(chen).toContain('Both unassigned')
    expect(chen).not.toContain(ARROW)
    expect(chen).toContain(DASH)
  })

  it('keeps the arrow where the two boards genuinely disagree', async () => {
    // A `conflict` is the only family verdict with two answers, so it is the
    // only one that spells `scenario -> CampMinder`.
    renderModal()
    const rows = await differenceRows()
    const okafor = rows.find((text) => text.includes('Rowan (9) Okafor')) ?? ''
    expect(okafor).toContain(ARROW)
    expect(okafor).toContain('Beta 1 + Beta 2')
  })

  it('keeps the one-sided arrow on add and remove, where the dash is the point', async () => {
    // `Beta 3 -> —` and `— -> Alpha 3` are not restatements: the dash is the
    // half of the comparison that holds nobody, and it only reads as an
    // absence next to the side that does.
    renderModal()
    const rows = await differenceRows()
    const novak = rows.find((text) => text.includes('The Novak Family')) ?? ''
    const ferraro = rows.find((text) => text.includes('The Ferraro Family')) ?? ''
    expect(novak).toContain(`Beta 3${ARROW}${DASH}`)
    expect(ferraro).toContain(`${DASH}${ARROW}Alpha 3`)
  })

  it('names a matching write-in once too, keeping the halves in step', async () => {
    // The write-in row carries the same `draft -> live` shape, so a matched
    // building must not restate its occupants either.
    renderModal()
    await screen.findAllByTestId('compare-write-in-row')
    await userEvent.click(screen.getByRole('button', { name: /matching write-in/i }))
    const rows = await screen.findAllByTestId('compare-write-in-row')
    const delacroix = rows.map((r) => r.textContent).find((t) => t.includes('Delacroix')) ?? ''
    expect((delacroix.match(/Delacroix/g) ?? []).length).toBe(1)
    expect(delacroix).not.toContain(ARROW)
  })
})

describe('ScenarioCompareModal — a placement is named the way the board draws it', () => {
  /**
   * A house and its two rooms, at whichever draw level the test wants. Owner
   * ruling, 2026-08-28: "take the board's state label ... if staff splits
   * [a house] on the board and reopens the modal, it should reflect the board
   * state. right now board is the authority." The bracket stands in for the
   * real house the ruling named -- `verify-no-hardcoded-lodging.sh` scans
   * tests too, so the fixture invents one.
   */
  function deltaHouse(combined: boolean): LodgingUnitRow[] {
    return [
      unitRow({
        code: 'delta-house',
        name: 'Delta House',
        is_container: true,
        is_combined: combined,
      }),
      unitRow({ code: 'delta-1', name: 'Delta 1', parent_code: 'delta-house' }),
      unitRow({ code: 'delta-2', name: 'Delta 2', parent_code: 'delta-house' }),
    ]
  }

  /** One family, placed on the whole house in the plan and nowhere in CampMinder. */
  const WHOLE_HOUSE: ScenarioCompare = {
    ...COMPARE,
    counts: { match: 0, both_unassigned: 0, conflict: 0, add: 1, remove: 0 },
    parties: [
      {
        grain: 'household',
        household_cm_id: 201,
        person_cm_id: 0,
        display_name: 'The Adeyemi Family',
        cls: 'add',
        both_unassigned: false,
        scenario_unit_label: 'Delta 1 + Delta 2',
        scenario_unit_codes: ['delta-1', 'delta-2'],
        mirror_unit_label: '',
        mirror_unit_codes: [],
      },
    ],
    write_ins: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncStatus.mockReturnValue({
      data: { lodging_assignments: { status: 'success', end_time: new Date().toISOString() } },
    })
  })

  afterEach(() => {
    mockRosterUnits = undefined
  })

  it('names a whole combined house by the house, as the board heads its card', async () => {
    // The owner's report. `unit_name` joins the rooms because the assignment
    // row names two units, but the board draws ONE card headed `Delta House` and
    // rolls both rooms onto it -- so the modal was showing staff a placement
    // spelled a way the board never spells it.
    mockRosterUnits = deltaHouse(true)
    renderModal(WHOLE_HOUSE)
    const rows = await differenceRows()
    expect(rows.some((t) => t.includes('Delta House'))).toBe(true)
    expect(rows.some((t) => t.includes('Delta 1'))).toBe(false)
  })

  it('follows the board when staff split the house', async () => {
    // The half that makes this the BOARD'S label rather than a prettier one of
    // our own: split the card and the rooms are two cards again, so the same
    // placement must read as two rooms again.
    mockRosterUnits = deltaHouse(false)
    renderModal(WHOLE_HOUSE)
    const rows = await differenceRows()
    expect(rows.some((t) => t.includes('Delta 1 + Delta 2'))).toBe(true)
  })

  it("keeps the roster's own label when the board's registry is not loaded", async () => {
    // The modal reads the board's payload out of the SAME query key the board
    // renders from, so in the page it is a cache hit -- but a cold open, or a
    // code the registry has never heard of, must still name the cabin rather
    // than render a blank where one belongs.
    mockRosterUnits = undefined
    renderModal(WHOLE_HOUSE)
    const rows = await differenceRows()
    expect(rows.some((t) => t.includes('Delta 1 + Delta 2'))).toBe(true)
  })

  it('still says nothing for the side that holds nobody', async () => {
    // An `add` has an empty mirror side, and "" there means UNPLACED -- it must
    // keep reading as the em-dash, never as a name the board failed to supply.
    mockRosterUnits = deltaHouse(true)
    renderModal(WHOLE_HOUSE)
    const rows = await differenceRows()
    // The whole `add` row, exactly: the house the board draws, the arrow, and
    // the em-dash for the side CampMinder never placed.
    expect(rows.some((t) => t.includes('Delta House\u2192\u2014'))).toBe(true)
  })

  /**
   * The collision the roll-up creates. CampMinder holds the family in the two
   * rooms and the plan holds them in the combined house: the verdict is a
   * `conflict` -- exact set inequality on the codes, the owner's ruling and
   * untouched here -- but both sides roll up to the one card the board draws,
   * so the row read `Delta House -> Delta House · Different cabin`.
   */
  const OKAFOR_CONFLICT: CompareParty = {
    grain: 'household',
    household_cm_id: 301,
    person_cm_id: 0,
    display_name: 'The Okafor Family',
    cls: 'conflict',
    both_unassigned: false,
    scenario_unit_label: 'Delta House',
    scenario_unit_codes: ['delta-house'],
    mirror_unit_label: 'Delta 1 + Delta 2',
    mirror_unit_codes: ['delta-1', 'delta-2'],
  }

  const COLLIDING: ScenarioCompare = {
    ...COMPARE,
    counts: { match: 1, both_unassigned: 0, conflict: 1, add: 0, remove: 0 },
    parties: [
      OKAFOR_CONFLICT,
      {
        grain: 'household',
        household_cm_id: 302,
        person_cm_id: 0,
        display_name: 'The Adeyemi Family',
        cls: 'match',
        both_unassigned: false,
        scenario_unit_label: 'Delta 1 + Delta 2',
        scenario_unit_codes: ['delta-1', 'delta-2'],
        mirror_unit_label: 'Delta 1 + Delta 2',
        mirror_unit_codes: ['delta-1', 'delta-2'],
      },
    ],
    write_ins: [],
  }

  it('spells out the rooms when both sides roll up to the same card', async () => {
    mockRosterUnits = deltaHouse(true)
    renderModal(COLLIDING)
    const rows = await differenceRows()
    expect(rows.some((t) => t.includes('Delta House→Delta House (Delta 1 + Delta 2)'))).toBe(true)
  })

  it('leaves the side that named the house alone', async () => {
    // Only the half that needs explaining gets it. The scenario named the
    // house, the board draws the house, and `Delta House (Delta House)` would
    // be noise on the side that never disagreed with its own label.
    mockRosterUnits = deltaHouse(true)
    renderModal(COLLIDING)
    const rows = await differenceRows()
    const okafor = rows.find((t) => t.includes('The Okafor Family')) ?? ''
    expect(okafor).not.toContain('(Delta House)')
  })

  it('gives BOTH sides the detail when both of them need it', async () => {
    // Two different rooms of one combined house is the symmetric case: neither
    // label explains itself, so neither is left bare.
    mockRosterUnits = deltaHouse(true)
    renderModal({
      ...COLLIDING,
      counts: { match: 0, both_unassigned: 0, conflict: 1, add: 0, remove: 0 },
      parties: [
        {
          ...OKAFOR_CONFLICT,
          scenario_unit_label: 'Delta 1',
          scenario_unit_codes: ['delta-1'],
          mirror_unit_label: 'Delta 2',
          mirror_unit_codes: ['delta-2'],
        },
      ],
    })
    const rows = await differenceRows()
    expect(rows.some((t) => t.includes('Delta House (Delta 1)→Delta House (Delta 2)'))).toBe(true)
  })

  it('adds nothing to a conflict whose two labels already differ', async () => {
    // The guard that keeps this out of every other conflict row: two houses
    // named apart say what happened on their own, and a parenthetical there
    // would spend the common case on the rare one. Both sides WOULD have a
    // footnote to write -- each is a merged house named by its rooms -- so
    // this fails the moment the collision test stops gating it.
    mockRosterUnits = [
      ...deltaHouse(true),
      unitRow({ code: 'echo-house', name: 'Echo House', is_container: true, is_combined: true }),
      unitRow({ code: 'echo-1', name: 'Echo 1', parent_code: 'echo-house' }),
      unitRow({ code: 'echo-2', name: 'Echo 2', parent_code: 'echo-house' }),
    ]
    renderModal({
      ...COLLIDING,
      counts: { match: 0, both_unassigned: 0, conflict: 1, add: 0, remove: 0 },
      parties: [
        {
          ...OKAFOR_CONFLICT,
          scenario_unit_label: 'Delta 1 + Delta 2',
          scenario_unit_codes: ['delta-1', 'delta-2'],
          mirror_unit_label: 'Echo 1 + Echo 2',
          mirror_unit_codes: ['echo-1', 'echo-2'],
        },
      ],
    })
    const rows = await differenceRows()
    const okafor = rows.find((t) => t.includes('The Okafor Family')) ?? ''
    expect(okafor).toContain('Delta House→Echo House')
    expect(okafor).not.toContain('(')
  })

  it('adds nothing to a match, whose one label is the agreement', async () => {
    // A match states its unit ONCE and the pill carries the rest. Its roster
    // label differs from the board's here -- rooms against the house -- and
    // that difference is not a disagreement to explain.
    mockRosterUnits = deltaHouse(true)
    renderModal(COLLIDING)
    await screen.findAllByTestId('compare-difference-row')
    await userEvent.click(screen.getByRole('button', { name: /matching famil/i }))
    const rows = await screen.findAllByTestId('compare-match-row')
    const adeyemi =
      rows.map((r) => r.textContent).find((t) => t.includes('The Adeyemi Family')) ?? ''
    expect(adeyemi).toContain('Delta House')
    expect(adeyemi).not.toContain('(')
  })

  it('keeps the em-dash when the board can draw neither side', async () => {
    // A container whose rooms have fallen out of the payload is placed but
    // undrawable (`boardLayout`'s invariant 2), so the board has no name for it
    // -- and "" there means UNPLACED to `UnitLabel`. The footnote must not turn
    // that em-dash into a stray ` (Delta House)`.
    mockRosterUnits = [
      unitRow({ code: 'delta-house', name: 'Delta House', is_container: true, is_combined: false }),
    ]
    renderModal({
      ...COLLIDING,
      counts: { match: 0, both_unassigned: 0, conflict: 1, add: 0, remove: 0 },
      parties: [
        {
          ...OKAFOR_CONFLICT,
          scenario_unit_label: '',
          scenario_unit_codes: ['delta-house'],
          mirror_unit_label: '',
          mirror_unit_codes: ['larkspur-9'],
        },
      ],
    })
    const rows = await differenceRows()
    const okafor = rows.find((t) => t.includes('The Okafor Family')) ?? ''
    expect(okafor).toContain('—→—')
    expect(okafor).not.toContain('(')
  })

  it('writes no empty parenthetical when the registry cannot name the units', async () => {
    // The rooms are in the payload but carry no name of their own, so the
    // footnote has nothing to say. It degrades to the bare label -- never to
    // `Delta House ()`, and never to the codes.
    mockRosterUnits = [
      unitRow({ code: 'delta-house', name: 'Delta House', is_container: true, is_combined: true }),
      unitRow({ code: 'delta-1', name: '', parent_code: 'delta-house' }),
      unitRow({ code: 'delta-2', name: '', parent_code: 'delta-house' }),
    ]
    renderModal({
      ...COLLIDING,
      counts: { match: 0, both_unassigned: 0, conflict: 1, add: 0, remove: 0 },
      parties: [{ ...OKAFOR_CONFLICT, mirror_unit_label: '' }],
    })
    const rows = await differenceRows()
    const okafor = rows.find((t) => t.includes('The Okafor Family')) ?? ''
    expect(okafor).toContain('Delta House→Delta House')
    expect(okafor).not.toContain('(')
  })

  it("says nothing extra when the board's registry is not loaded", async () => {
    // Cold open: neither side is rolled up, so the roster's own labels stand
    // and they already differ. Nothing collides, nothing is spelled out.
    mockRosterUnits = undefined
    renderModal(COLLIDING)
    const rows = await differenceRows()
    const okafor = rows.find((t) => t.includes('The Okafor Family')) ?? ''
    expect(okafor).toContain('Delta House→Delta 1 + Delta 2')
    expect(okafor).not.toContain('(')
  })
})
