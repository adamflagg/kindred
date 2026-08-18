/**
 * The family-camp household journey (kindred#2073).
 *
 * ★ THE DATA HAS FIVE STATES, NOT TWO, and conflating any pair of them is the
 * defect this file exists to prevent. Measured on the production snapshot
 * 2026-08-09:
 *
 * 1. 2022-2025 carry housing history; 423 households are placed in two or
 *    more of those four years.
 * 2. 2017-2021 carry 1,433 family registrations and ZERO cabin assignments,
 *    so a blank there is a gap in the RECORD — "housing unknown", never
 *    "attended, unplaced".
 * 3. 2026 is ~16% placed, so a blank there is a genuine to-do — "not yet
 *    placed". Keeping those two strings distinct IS the point.
 * 4. 2020 has 1,264 family attendee rows and not one enrolled: the season was
 *    cancelled.
 * 5. 2021 has no family attendee rows at all despite 247 registrations, while
 *    `family_camp_adults` carries 647 rows across 351 households — so 2021
 *    shows adults and no children, and must not read as a childless family.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import type { HouseholdJourney, HouseholdJourneyRow } from '../../types/lodging'
import { HouseholdJourneyCard } from './HouseholdJourneyCard'

// A linked child's name is a `<Link>` (kindred#2329), which throws outside a
// Router context — the modal is closed by default in most of these tests,
// so it wouldn't render, but "see members" tests below open it.
function renderCard(props: Parameters<typeof HouseholdJourneyCard>[0]) {
  return render(
    <MemoryRouter>
      <HouseholdJourneyCard {...props} />
    </MemoryRouter>
  )
}

const journeyResult = {
  value: { data: undefined, isLoading: false, error: null } as {
    data: HouseholdJourney | undefined
    isLoading: boolean
    error: Error | null
  },
}

const useHouseholdJourney = vi.fn(() => journeyResult.value)

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdJourney: (...args: unknown[]) => useHouseholdJourney(...(args as [])),
}))

beforeEach(() => {
  journeyResult.value = { data: undefined, isLoading: false, error: null }
  useHouseholdJourney.mockClear()
})

function _row(overrides: Partial<HouseholdJourneyRow> = {}): HouseholdJourneyRow {
  return {
    year: 2025,
    housing: 'placed',
    cabin_name: 'Cedar Lodge - Room 2',
    enrollment: 'enrolled',
    adults: [{ adult_number: 1, display_name: 'Olivia Johnson', relationship: 'Parent' }],
    children: [
      {
        person_cm_id: 1000001,
        display_name: 'Emma Johnson',
        last_name: 'Johnson',
        age: 9,
        grade: 4,
      },
    ],
    ...overrides,
  }
}

function show(years: HouseholdJourneyRow[], currentYear = 2026) {
  journeyResult.value = {
    data: { household_cm_id: 2000001, years },
    isLoading: false,
    error: null,
  }
  return renderCard({ householdCmId: 2000001, currentYear })
}

function rowFor(year: number): HTMLElement {
  const row = document.querySelector(`[data-testid="household-journey-row"][data-year="${year}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no journey row for ${String(year)}`)
  return row
}

describe('the housing states', () => {
  it('shows the staff-written cabin for a placed year', () => {
    show([_row({ year: 2025, housing: 'placed', cabin_name: 'Cedar Lodge - Room 2' })])

    expect(rowFor(2025).textContent).toContain('Cedar Lodge - Room 2')
  })

  it('calls a year that recorded no cabin for ANYBODY "housing unknown"', () => {
    show([_row({ year: 2019, housing: 'unknown', cabin_name: '' })])

    const text = rowFor(2019).textContent
    expect(text).toContain('Housing unknown')
    // The 2017-2021 gap is a gap in the record, and reporting it as a family
    // who went unhoused is a statement staff cannot defend.
    expect(text).not.toContain('Not yet placed')
    expect(text).not.toContain('No cabin on file')
  })

  it('calls a blank in the season being worked "not yet placed"', () => {
    show([_row({ year: 2026, housing: 'not_placed', cabin_name: '' })], 2026)

    const text = rowFor(2026).textContent
    expect(text).toContain('Not yet placed')
    expect(text).not.toContain('Housing unknown')
  })

  it('calls a blank in a PAST year that recorded cabins "no cabin on file"', () => {
    show([_row({ year: 2023, housing: 'not_placed', cabin_name: '' })], 2026)

    const text = rowFor(2023).textContent
    expect(text).toContain('No cabin on file')
    // A to-do is a to-do only on the season somebody is working.
    expect(text).not.toContain('Not yet placed')
  })

  it('keeps "housing unknown" and "not yet placed" as different strings', () => {
    show(
      [
        _row({ year: 2026, housing: 'not_placed', cabin_name: '' }),
        _row({ year: 2019, housing: 'unknown', cabin_name: '' }),
      ],
      2026
    )

    expect(rowFor(2026).textContent).not.toEqual(rowFor(2019).textContent)
  })

  it('lets a long lodging name wrap instead of clipping it with an ellipsis', () => {
    // kindred#2253. A unit name with a wing or sub-unit suffix loses exactly
    // that suffix to `truncate`'s ellipsis — the half that distinguishes it
    // from a same-building sibling.
    show([
      _row({
        year: 2025,
        housing: 'placed',
        cabin_name: 'Fernwood Lodge - West Wing Room 12B',
      }),
    ])

    const housing = screen.getByTestId('household-journey-housing')
    // `truncate` is Tailwind's `overflow-hidden` + ellipsis + `nowrap`
    // combined into one class. `min-w-0` is the OTHER half of the mechanism
    // — it is what lets this flex child shrink below its content width at
    // all — and it stays: dropping only `truncate` is what lets the name
    // wrap instead of overflowing its row.
    expect(housing).toHaveClass('min-w-0')
    expect(housing).not.toHaveClass('truncate')
    expect(housing).toHaveTextContent('Fernwood Lodge - West Wing Room 12B')
  })
})

describe('the enrollment states', () => {
  it('flags a year with no enrolled child rather than showing nothing', () => {
    show([_row({ year: 2021, enrollment: 'none_on_file', children: [] })])

    expect(within(rowFor(2021)).getByText('No enrollment')).toBeInTheDocument()
  })

  it('does not flag a year that has one', () => {
    show([_row({ year: 2025, enrollment: 'enrolled' })])

    expect(within(rowFor(2025)).queryByText('No enrollment')).not.toBeInTheDocument()
  })

  it('explains the flag on a tooltip a keyboard and a tablet can reach', () => {
    // kindred#2177. This chip is on the weekend surface and carried the same
    // bare `title` as the rest of it — it just landed late enough to miss the
    // sweep's file list, which is exactly how a half-swept surface happens.
    // The row around it is a `<div>`, not a `<button>`, so unlike
    // `HouseholdRosterRow`'s in-button badges this one CAN be a real trigger.
    show([_row({ year: 2021, enrollment: 'none_on_file', children: [] })])

    const chip = within(rowFor(2021)).getByRole('button', { name: 'No enrollment' })
    expect(chip).not.toHaveAttribute('title')

    fireEvent.focus(chip)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/no enrolled child/i)
  })
})

describe('the family name', () => {
  it('names the household from the UNION of its children across every year', () => {
    show([
      _row({
        year: 2025,
        children: [
          {
            person_cm_id: 1000002,
            display_name: 'Liam Garcia',
            last_name: 'Garcia',
            age: 7,
            grade: 2,
          },
        ],
      }),
      _row({
        year: 2023,
        children: [
          {
            person_cm_id: 1000001,
            display_name: 'Emma Johnson',
            last_name: 'Johnson',
            age: 9,
            grade: 4,
          },
        ],
      }),
    ])

    expect(screen.getByTestId('household-journey-title').textContent).toBe(
      'The Garcia & Johnson Family'
    )
  })

  it('does not repeat a surname once per year it appears in', () => {
    // The union is assembled by concatenating per-year lists, so a
    // four-year household repeats its surname four times — in whatever
    // casing each year's CampMinder record was typed in. `familyNameLabel`
    // was made idempotent for exactly this caller; without it the heading
    // reads "The Johnson, johnson & Johnson Family".
    show([
      _row({
        year: 2025,
        children: [
          { person_cm_id: 1, display_name: 'Emma Johnson', last_name: 'Johnson', age: 9, grade: 4 },
        ],
      }),
      _row({
        year: 2024,
        children: [
          { person_cm_id: 1, display_name: 'Emma johnson', last_name: 'johnson', age: 8, grade: 3 },
        ],
      }),
      _row({
        year: 2023,
        children: [
          { person_cm_id: 1, display_name: 'Emma Johnson', last_name: 'Johnson', age: 7, grade: 2 },
        ],
      }),
    ])

    expect(screen.getByTestId('household-journey-title').textContent).toBe('The Johnson Family')
  })

  it('treats a hyphenated surname as ONE name', () => {
    show([
      _row({
        year: 2025,
        children: [
          {
            person_cm_id: 1,
            display_name: 'Ava Garcia-Lopez',
            last_name: 'Garcia-Lopez',
            age: 9,
            grade: 4,
          },
        ],
      }),
    ])

    expect(screen.getByTestId('household-journey-title').textContent).toBe(
      'The Garcia-Lopez Family'
    )
  })

  it('lets a long family name wrap instead of clipping it with an ellipsis', () => {
    // kindred#2253's second anchor: the header carries the same `truncate`
    // as the year row, and a multi-surname household is exactly as likely to
    // overflow it as a long unit name is to overflow the row.
    show([
      _row({
        year: 2025,
        children: [
          { person_cm_id: 1, display_name: 'Emma Johnson', last_name: 'Johnson', age: 9, grade: 4 },
        ],
      }),
      _row({
        year: 2023,
        children: [
          {
            person_cm_id: 2,
            display_name: 'Liam Garcia-Lopez',
            last_name: 'Garcia-Lopez',
            age: 7,
            grade: 2,
          },
        ],
      }),
      _row({
        year: 2021,
        children: [
          {
            person_cm_id: 3,
            display_name: 'Ava Martinez',
            last_name: 'Martinez',
            age: 6,
            grade: 1,
          },
        ],
      }),
    ])

    expect(screen.getByTestId('household-journey-title')).not.toHaveClass('truncate')
  })

  it('falls back to a neutral heading when no child on any year carries a surname', () => {
    show([_row({ year: 2021, enrollment: 'none_on_file', children: [] })])

    expect(screen.getByTestId('household-journey-title').textContent).toBe('Family Camp history')
  })
})

describe('see members', () => {
  it('opens THAT year’s party, never an adjacent one', () => {
    show([
      _row({
        year: 2025,
        adults: [{ adult_number: 1, display_name: 'Olivia Johnson', relationship: 'Parent' }],
        children: [
          { person_cm_id: 1, display_name: 'Emma Johnson', last_name: 'Johnson', age: 9, grade: 4 },
        ],
      }),
      _row({
        year: 2023,
        adults: [{ adult_number: 1, display_name: 'Noah Johnson', relationship: 'Parent' }],
        children: [
          { person_cm_id: 2, display_name: 'Liam Johnson', last_name: 'Johnson', age: 6, grade: 1 },
        ],
      }),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'See members for 2023' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Noah Johnson')
    expect(dialog.textContent).toContain('Liam Johnson')
    expect(dialog.textContent).not.toContain('Olivia Johnson')
    expect(dialog.textContent).not.toContain('Emma Johnson')
  })

  it('offers no affordance for a year with nobody on file', () => {
    show([_row({ year: 2020, enrollment: 'none_on_file', adults: [], children: [] })])

    expect(screen.queryByRole('button', { name: 'See members for 2020' })).not.toBeInTheDocument()
  })

  it('does not count a blank adult slot toward having members', () => {
    show([
      _row({
        year: 2020,
        enrollment: 'none_on_file',
        adults: [{ adult_number: 1, display_name: 'NA', relationship: '' }],
        children: [],
      }),
    ])

    expect(screen.queryByRole('button', { name: 'See members for 2020' })).not.toBeInTheDocument()
  })
})

describe('the four query states', () => {
  it('renders a loading state', () => {
    journeyResult.value = { data: undefined, isLoading: true, error: null }
    renderCard({ householdCmId: 2000001, currentYear: 2026 })

    expect(screen.getByText(/Loading family history/)).toBeInTheDocument()
  })

  it('does not claim a count it has not loaded yet', () => {
    // The band sits ABOVE the guard, so it renders while the read is in
    // flight. "0 years on file" is a statement of fact, and printing it over
    // a spinner tells a staff member a returning family is a first-timer —
    // for the whole fetch, on every open of the panel.
    journeyResult.value = { data: undefined, isLoading: true, error: null }
    renderCard({ householdCmId: 2000001, currentYear: 2026 })

    expect(screen.queryByText(/on file/)).not.toBeInTheDocument()
  })

  it('renders the error inline rather than escalating to the page boundary', () => {
    journeyResult.value = { data: undefined, isLoading: false, error: new Error('boom') }
    renderCard({ householdCmId: 2000001, currentYear: 2026 })

    expect(screen.getByText(/boom/)).toBeInTheDocument()
    // Same reason as the loading case: a failed read knows nothing about how
    // many years are on file.
    expect(screen.queryByText(/on file/)).not.toBeInTheDocument()
  })

  it('states the count once the record is in hand', () => {
    show([_row({ year: 2025 }), _row({ year: 2023 })])

    expect(screen.getByText('2 years on file')).toBeInTheDocument()
  })

  it('says "year" singular for a one-year household', () => {
    show([_row({ year: 2025 })])

    expect(screen.getByText('1 year on file')).toBeInTheDocument()
  })

  it('says a first-time family has no history rather than showing an empty rail', () => {
    show([])

    expect(screen.getByText('No family camp history on file')).toBeInTheDocument()
  })

  it('renders one row per year, newest first', () => {
    show([_row({ year: 2025 }), _row({ year: 2023 }), _row({ year: 2019 })])

    const years = [...document.querySelectorAll('[data-testid="household-journey-row"]')].map(
      (el) => el.getAttribute('data-year')
    )
    expect(years).toEqual(['2025', '2023', '2019'])
  })
})

describe('a party with no household', () => {
  it('renders nothing and never fetches', () => {
    const { container } = renderCard({ householdCmId: null, currentYear: 2026 })

    expect(container.textContent).toBe('')
    expect(useHouseholdJourney).toHaveBeenCalledWith(null)
  })
})

/**
 * kindred#2332. A prior year's housing renders in TODAY's language.
 *
 * Owner ruling 2026-08-18: *"the last year housing should use the same
 * language via the alias year over year concept so it appears in current
 * language."* The server does the resolving — `cabin_name` is already the
 * unit's present-day registry name and `cabin_name_raw` is what staff typed
 * that season. What this surface owes is the provenance, and only where the
 * two disagree: 716 of 1,861 rows on the production snapshot, and 1,145 where
 * showing it would be noise.
 */
describe('the raw staff-written string, as provenance', () => {
  it('offers what staff wrote when it disagrees with the registry name', () => {
    show([
      _row({
        year: 2022,
        housing: 'placed',
        cabin_name: 'Meadow House 1',
        cabin_name_raw: 'Old Meadow 1',
      }),
    ])

    const trigger = within(rowFor(2022)).getByTestId('household-journey-housing-provenance')
    expect(trigger.textContent).toContain('Meadow House 1')

    fireEvent.pointerEnter(trigger)

    expect(screen.getByRole('tooltip').textContent).toContain('Old Meadow 1')
  })

  it('leaves nothing pinned open after a click', () => {
    // The affordance is informational: it restates the season's raw string and
    // offers nothing to act on. Pinning it left a bubble covering the rows
    // below after a click that meant nothing, which read as a stuck popover.
    show([
      _row({
        year: 2022,
        housing: 'placed',
        cabin_name: 'Meadow House 1',
        cabin_name_raw: 'Old Meadow 1',
      }),
    ])

    const trigger = within(rowFor(2022)).getByTestId('household-journey-housing-provenance')
    fireEvent.pointerEnter(trigger)
    fireEvent.click(trigger)
    fireEvent.pointerOut(trigger, { relatedTarget: document.body })

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('says nothing extra when the raw string IS the registry name', () => {
    show([
      _row({
        year: 2025,
        housing: 'placed',
        cabin_name: 'Cedar Lodge 2',
        cabin_name_raw: 'Cedar Lodge 2',
      }),
    ])

    expect(within(rowFor(2025)).queryByTestId('household-journey-housing-provenance')).toBeNull()
    expect(rowFor(2025).textContent).toContain('Cedar Lodge 2')
  })

  it('says nothing extra on a year with no cabin at all', () => {
    show([_row({ year: 2019, housing: 'unknown', cabin_name: '', cabin_name_raw: '' })])

    expect(within(rowFor(2019)).queryByTestId('household-journey-housing-provenance')).toBeNull()
    expect(rowFor(2019).textContent).toContain('Housing unknown')
  })

  it('says nothing extra when the server sent no raw string', () => {
    // An older payload, or a client reading a field a regen dropped. The name
    // still renders; only the provenance affordance goes away.
    show([_row({ year: 2023, housing: 'placed', cabin_name: 'Meadow House 1' })])

    expect(within(rowFor(2023)).queryByTestId('household-journey-housing-provenance')).toBeNull()
    expect(rowFor(2023).textContent).toContain('Meadow House 1')
  })
})

/**
 * WHICH WEEKENDS the household attended in a year (kindred#2393).
 *
 * A journey row is a YEAR, and until now the panel never said which of a
 * season's six-to-ten family weekends the year was. 64 of 5,438 journey
 * household-years (1.2%) are multi-weekend — the denominator being every
 * traced household-year, the union of the three reads the journey issues,
 * over all years with `year > 0`.
 *
 * ⚠️ ONE CABIN, RENDERED ONCE. The year holds exactly one cabin string and
 * repeating it against each weekend is the fan-out that manufactured 12 of 17
 * false multi-family occupancies in the phase-C shareability analysis. The
 * owner's 2026-08-18 ruling also DROPPED the "cabin recorded for the year"
 * note — staff know CampMinder overwrites the source value, and the note
 * would have sat beside the existing "No enrollment" chip saying nearly the
 * same thing.
 */
describe('the weekend line', () => {
  const FC1 = {
    session_cm_id: 1309514,
    name: 'Family Camp 1: Memorial Day Weekend',
    start_date: '2025-05-23',
  }
  const FC4 = {
    session_cm_id: 1309517,
    name: 'Family Camp 4: Labor Day Weekend',
    start_date: '2025-09-05',
  }
  const RSC = { session_cm_id: 1366768, name: 'Ready, Set, Camp', start_date: '2025-06-13' }

  function weekendLineFor(year: number): HTMLElement | null {
    return within(rowFor(year)).queryByTestId('household-journey-weekends')
  }

  it('names every weekend the household attended, as plain FCx text', () => {
    show([_row({ year: 2025, sessions: [FC1, FC4] })])

    expect(weekendLineFor(2025)?.textContent).toBe('FC1 · FC4')
  })

  it('prints a weekend CampMinder never numbered by its own name', () => {
    // The licence is for `FCx` and only for `FCx` — the number is the
    // weekend's identity, so the abbreviation cannot name a different one.
    // Initials of a prose name carry no such guarantee: they gave both
    // "Spring Family Camp" and "Summer Family Camp" the label `SFC` and read
    // "Fall Family Camp II" back as `FFCI`, on 891 of 3,040 single-weekend
    // household-years. See `weekendNames.test.ts` for the season sweep.
    show([_row({ year: 2025, sessions: [RSC] })])

    expect(weekendLineFor(2025)?.textContent).toBe('Ready, Set, Camp')
  })

  it('never prints a bare CampMinder id when a name has no abbreviation', () => {
    // `weekendSlug` declines to address a digits-only name — the numeric space
    // belongs to CampMinder ids — and `weekendRef` falls back to the id for
    // that. A LABEL must not: `1379005` names nothing a staff member reads.
    show([
      _row({ year: 2025, sessions: [{ session_cm_id: 1379005, name: '2025', start_date: '' }] }),
    ])

    expect(weekendLineFor(2025)?.textContent).toBe('2025')
    expect(rowFor(2025).textContent).not.toContain('1379005')
  })

  it('renders no weekend line at all when no weekend is knowable', () => {
    // 2021 has no family attendee rows despite 247 registrations, and the
    // pre-kindred#2420 payload shape did not expand the session relation
    // either. Empty is "not knowable", so the row says nothing rather than
    // printing an empty line under the housing name.
    show([_row({ year: 2021, sessions: [] })])

    expect(weekendLineFor(2021)).toBeNull()
  })

  it('prints the cabin ONCE for a multi-weekend year, never once per weekend', () => {
    show([
      _row({
        year: 2025,
        housing: 'placed',
        cabin_name: 'Cedar Lodge - Room 2',
        sessions: [FC1, FC4],
      }),
    ])

    const text = rowFor(2025).textContent ?? ''
    expect(text.split('Cedar Lodge - Room 2')).toHaveLength(2)
  })

  it('adds no explanatory note for a year whose cabin belongs to no one weekend', () => {
    // The owner struck it on 2026-08-18. The rule it came from is unchanged —
    // one cabin, rendered once — but the sentence is not on the panel.
    show([
      _row({
        year: 2025,
        housing: 'placed',
        cabin_name: 'Cedar Lodge - Room 2',
        sessions: [FC1, FC4],
        housing_session_cm_id: null,
      }),
    ])

    const text = rowFor(2025).textContent ?? ''
    expect(text).not.toContain('for the year')
    expect(text).not.toContain('unresolved')
  })
})
