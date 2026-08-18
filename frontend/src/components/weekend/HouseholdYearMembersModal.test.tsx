/**
 * The "see members" expansion off the family-camp journey (kindred#2073).
 *
 * What this pins, and why each one is a real failure mode rather than a
 * rendering detail:
 *
 * * **Adults are half the answer.** A family-camp party is a household, and
 *   its adults have NO `persons` row anywhere — `family_camp_adults` is their
 *   only representation. A modal that showed only children would be missing
 *   the people staff are usually trying to remember.
 * * **A blank adult slot is not an adult.** The scrape has five fixed slots
 *   and leaves the unused ones empty; the server publishes every row on
 *   purpose so ONE client predicate decides, and this is a place that
 *   predicate has to be applied.
 * * **An empty child list is not a childless family.** 2020's family season
 *   was cancelled outright and 2021 has no family attendee rows at all
 *   despite 247 registrations — while adults exist for both years.
 */
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'

import type { HouseholdJourneyRow } from '../../types/lodging'
import { hasOpenModal } from '../ui/modalStack'
import { HouseholdYearMembersModal } from './HouseholdYearMembersModal'

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

// A child's name is a `<Link>` (kindred#2329), which throws outside a Router
// context — every caller needs one now, not just the navigation tests below.
function open(row: HouseholdJourneyRow | null, familyLabel = 'The Johnson Family') {
  return render(
    <MemoryRouter>
      <HouseholdYearMembersModal isOpen onClose={vi.fn()} row={row} familyLabel={familyLabel} />
    </MemoryRouter>
  )
}

describe('the party for one year', () => {
  it('lists children AND adults, not just the children', () => {
    open(_row())

    expect(screen.getByTestId('year-members-adults').textContent).toContain('Olivia Johnson')
    expect(screen.getByTestId('year-members-children').textContent).toContain('Emma Johnson')
  })

  it('prints an adult relationship beside the name', () => {
    open(_row())

    expect(screen.getByTestId('year-members-adults').textContent).toContain('Parent')
  })

  it('drops a blank or placeholder adult slot rather than printing a nameless row', () => {
    open(
      _row({
        adults: [
          { adult_number: 1, display_name: 'Olivia Johnson', relationship: 'Parent' },
          { adult_number: 2, display_name: '', relationship: '' },
          { adult_number: 3, display_name: 'NA', relationship: '' },
        ],
      })
    )

    expect(screen.getByTestId('year-members-adults').querySelectorAll('li')).toHaveLength(1)
  })

  it('counts only the people it prints', () => {
    open(
      _row({
        adults: [
          { adult_number: 1, display_name: 'Olivia Johnson', relationship: '' },
          { adult_number: 2, display_name: 'NA', relationship: '' },
        ],
      })
    )

    // One named adult plus one child.
    expect(screen.getByText(/2025 · 2 people/)).toBeInTheDocument()
  })

  it('omits an age or grade it does not have rather than printing zero', () => {
    open(
      _row({
        children: [
          {
            person_cm_id: 1000002,
            display_name: 'Liam Garcia',
            last_name: 'Garcia',
            age: null,
            grade: 0,
          },
        ],
      })
    )

    const children = screen.getByTestId('year-members-children').textContent
    expect(children).toContain('Liam Garcia')
    expect(children).not.toContain('Grade 0')
    expect(children).not.toContain('Age')
  })

  // CampMinder stores 13 for a camper past 12th grade: 224 persons carry it
  // and nothing above it. It is a real value but a nonsensical label, so it
  // is suppressed the same way an absent grade is -- the age still prints.
  it('omits a grade above 12 rather than printing a nonsensical one', () => {
    open(
      _row({
        children: [
          {
            display_name: 'Emma Johnson',
            last_name: 'Johnson',
            person_cm_id: 1000001,
            age: 18,
            grade: 13,
          },
        ],
      })
    )

    const children = screen.getByRole('dialog').textContent
    expect(children).not.toContain('Grade 13')
    expect(children).not.toContain('Grade')
    expect(children).toContain('Age 18')
  })
})

describe('a year with no enrollment on file', () => {
  it('says so instead of rendering a childless family', () => {
    open(
      _row({
        year: 2021,
        enrollment: 'none_on_file',
        children: [],
        adults: [{ adult_number: 1, display_name: 'Olivia Johnson', relationship: 'Parent' }],
      })
    )

    expect(screen.getByTestId('year-members-no-enrollment').textContent).toContain(
      'No enrolled child on file for 2021'
    )
  })

  it('still lists the adults, who are the only record of that year', () => {
    open(
      _row({
        year: 2021,
        enrollment: 'none_on_file',
        children: [],
        adults: [{ adult_number: 1, display_name: 'Olivia Johnson', relationship: 'Parent' }],
      })
    )

    expect(screen.getByTestId('year-members-adults').textContent).toContain('Olivia Johnson')
  })

  it('does not claim a missing enrollment on a year that has one', () => {
    open(_row())

    expect(screen.queryByTestId('year-members-no-enrollment')).not.toBeInTheDocument()
  })
})

describe('the heading', () => {
  it('names the dialog with the cross-year family label and the year', () => {
    open(_row())

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-labelledby', 'household-year-members-title')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('The Johnson Family')
    expect(screen.getByText(/^2025 · /)).toBeInTheDocument()
  })

  it('falls back to a neutral word rather than printing "The  Family"', () => {
    open(_row(), '')

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Household')
  })
})

describe('nothing to show', () => {
  it('renders no dialog at all with no row', () => {
    open(null)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('linking a member to their camper page for that year (kindred#2329)', () => {
  it("links a child with a person_cm_id to /camper/:id, carrying THIS row's year", () => {
    open(_row({ year: 2019 }))

    const link = screen.getByRole('link', { name: /Emma Johnson/ })
    expect(link).toHaveAttribute('href', '/camper/1000001?year=2019')
  })

  it('opens the camper page in a NEW TAB, safely rel-ed', () => {
    open(_row({ year: 2019 }))

    const link = screen.getByRole('link', { name: /Emma Johnson/ })
    expect(link).toHaveAttribute('target', '_blank')
    // Without noopener the opened tab gets a live `window.opener` handle
    // back into this one.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('renders a child with no person_cm_id as plain text, never a broken link', () => {
    open(
      _row({
        children: [
          // No `person_cm_id` at all — the data-completeness case, distinct
          // from the resolvability question the corrected issue body
          // settles (own-year resolution is 100% BY CONSTRUCTION once a
          // person_cm_id exists; this row simply doesn't have one).
          { display_name: 'Noah Smith', last_name: 'Smith', age: 7, grade: 2 },
        ],
      })
    )

    expect(screen.queryByRole('link', { name: /Noah Smith/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('year-members-children').textContent).toContain('Noah Smith')
  })

  it('never links an adult — PartyAdult carries no person_cm_id to link with', () => {
    open(_row())

    expect(screen.queryByRole('link', { name: /Olivia Johnson/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('year-members-adults').textContent).toContain('Olivia Johnson')
  })

  it('renders a fractional person_cm_id as plain text rather than a link to a truncated (wrong) camper', () => {
    // CodeRabbit review on PR #2345: `parseInt('1000001.5', 10)` truncates to
    // 1000001 — a link built from a non-integer id can silently land on a
    // DIFFERENT camper record than the one that was actually being shown.
    open(
      _row({
        children: [
          { person_cm_id: 1000001.5, display_name: 'Ava Martinez', last_name: 'Martinez' },
        ],
      })
    )

    expect(screen.queryByRole('link', { name: /Ava Martinez/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('year-members-children').textContent).toContain('Ava Martinez')
  })
})

describe('navigating to a linked camper unwinds the modal stack (kindred#2329)', () => {
  // `ui/Modal` targets `#root` for background inert; jsdom doesn't load
  // index.html, so tests recreate that element — same pattern as
  // `ui/Modal.test.tsx`'s "background inert" describe block.
  beforeEach(() => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
  })

  afterEach(() => {
    document.getElementById('root')?.remove()
  })

  // Mimics `HouseholdJourneyCard`'s own `openRow` state exactly: `onClose`
  // clears it, which is what flips the `Modal`'s `isOpen` prop to false.
  function Harness() {
    const [isOpen, setIsOpen] = useState(true)
    return (
      <HouseholdYearMembersModal
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false)
        }}
        row={_row({ year: 2019 })}
        familyLabel="The Johnson Family"
      />
    )
  }

  function renderAtWeekendRoute() {
    return render(
      <MemoryRouter initialEntries={['/weekend/roster']}>
        <Routes>
          <Route path="/weekend/roster" element={<Harness />} />
          <Route
            path="/camper/:camperId"
            element={<p data-testid="camper-page">Camper detail page</p>}
          />
        </Routes>
      </MemoryRouter>
    )
  }

  // The link opens a NEW TAB, so THIS tab must not move and the modal must
  // stay exactly as it was. The previous behaviour closed the modal on click,
  // which is wrong here: the user returns to this tab and finds their place
  // gone. `target="_blank"` also means react-router hands the click to the
  // browser rather than navigating in place, so no route change happens.
  it('leaves this tab untouched: modal open, stack intact, no navigation', () => {
    renderAtWeekendRoute()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.getElementById('root')).toHaveAttribute('inert')
    expect(hasOpenModal()).toBe(true)

    fireEvent.click(screen.getByRole('link', { name: /Emma Johnson/ }))

    // This tab did NOT navigate -- the camper page belongs to the new tab.
    expect(screen.queryByTestId('camper-page')).not.toBeInTheDocument()

    // And the modal is still standing, with the overlay stack still owning it.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.getElementById('root')).toHaveAttribute('inert')
    expect(hasOpenModal()).toBe(true)
  })
})

/**
 * WHICH WEEKEND (kindred#2393, owner ruling 2026-08-18: option A, tabs).
 *
 * ★ THIS IS THE HALF THAT ACTUALLY NEEDED THE SESSION GRAIN. A journey row is
 * a household-YEAR, so a family that booked two of a season's weekends
 * collapses into one merged member list. Measured on the production snapshot,
 * 64 of 5,438 journey household-years are multi-weekend and 7 of those 64
 * carry a child who did not attend every weekend — so today's list silently
 * overstates at least one weekend's party, and once the weekends appear on
 * the panel it becomes visibly wrong.
 *
 * ⚠️ THE ADULT LIST CANNOT BE TABBED. `family_camp_adults` is household-year
 * grain with NO session dimension, so adults have no per-weekend truth to
 * filter on. They render unchanged on every tab, and inventing an attendance
 * claim for them is kindred#1943 — blocked on a 2027 form change.
 */
describe('the weekend tabs', () => {
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

  /** Emma went to both weekends; Liam only to the first. The 7-of-64 case. */
  function _twoWeekendRow(overrides: Partial<HouseholdJourneyRow> = {}): HouseholdJourneyRow {
    return _row({
      sessions: [FC1, FC4],
      children: [
        {
          person_cm_id: 1000001,
          display_name: 'Emma Johnson',
          last_name: 'Johnson',
          age: 9,
          grade: 4,
          session_cm_ids: [1309514, 1309517],
        },
        {
          person_cm_id: 1000002,
          display_name: 'Liam Johnson',
          last_name: 'Johnson',
          age: 7,
          grade: 2,
          session_cm_ids: [1309514],
        },
      ],
      ...overrides,
    })
  }

  it('offers one tab per weekend plus All, labelled FCx', () => {
    open(_twoWeekendRow())

    const tabs = within(screen.getByTestId('year-members-weekend-tabs')).getAllByRole('button')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['All', 'FC1', 'FC4'])
  })

  it('opens on All, showing the whole year rather than one weekend of it', () => {
    // Both halves matter. The strip must SAY All is on — a mutation that
    // opened on the first weekend passed a names-only assertion, because
    // every child here attended the first weekend. And a child who attended
    // ONLY the later weekend must still be on screen at open.
    open(
      _twoWeekendRow({
        children: [
          {
            person_cm_id: 1000004,
            display_name: 'Noah Garcia',
            last_name: 'Garcia',
            age: 8,
            grade: 3,
            session_cm_ids: [1309517],
          },
        ],
      })
    )

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'FC1' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('year-members-children').textContent).toContain('Noah Garcia')
  })

  it('shows every child of a multi-weekend year on All', () => {
    open(_twoWeekendRow())

    const names = screen.getByTestId('year-members-children').textContent ?? ''
    expect(names).toContain('Emma Johnson')
    expect(names).toContain('Liam Johnson')
  })

  it('drops a child who did not attend the selected weekend', () => {
    open(_twoWeekendRow())

    fireEvent.click(screen.getByRole('button', { name: 'FC4' }))

    const names = screen.getByTestId('year-members-children').textContent ?? ''
    expect(names).toContain('Emma Johnson')
    expect(names).not.toContain('Liam Johnson')
  })

  it('brings the child back on the weekend they did attend', () => {
    open(_twoWeekendRow())

    fireEvent.click(screen.getByRole('button', { name: 'FC4' }))
    fireEvent.click(screen.getByRole('button', { name: 'FC1' }))

    expect(screen.getByTestId('year-members-children').textContent).toContain('Liam Johnson')
  })

  it('makes the headcount follow the selected tab', () => {
    open(_twoWeekendRow())

    // All: one adult + two children.
    expect(screen.getByText(/3 people/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'FC4' }))

    // FC4: the same adult + Emma alone. A headcount that stayed at 3 would be
    // the exact overstatement the tabs exist to remove.
    expect(screen.getByText(/2 people/)).toBeInTheDocument()
  })

  it('leaves the adult list untouched on a weekend tab', () => {
    // `family_camp_adults` has no session dimension. Filtering adults would be
    // an attendance claim nothing supports (kindred#1943).
    open(_twoWeekendRow())

    fireEvent.click(screen.getByRole('button', { name: 'FC4' }))

    expect(screen.getByTestId('year-members-adults').textContent).toContain('Olivia Johnson')
  })

  it('marks the selected tab pressed so the strip says which one is on', () => {
    open(_twoWeekendRow())

    fireEvent.click(screen.getByRole('button', { name: 'FC4' }))

    expect(screen.getByRole('button', { name: 'FC4' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows no tab strip for a single-weekend year', () => {
    // `All · FC1` splits nothing. The card's own weekend line already names
    // the weekend, so a strip here would be a control that cannot change
    // anything.
    open(_row({ sessions: [FC1] }))

    expect(screen.queryByTestId('year-members-weekend-tabs')).toBeNull()
  })

  it('shows no tab strip when every member attended every weekend', () => {
    /*
     * Owner ruling, 2026-08-18: "if all of the members are the same across all
     * sessions, we simply do not offer up the tabbed experience."
     *
     * This is the overwhelmingly common case, not an edge one. Measured on the
     * production snapshot: of every household that has ever attended more than
     * one weekend in a year, only SIX have differing members. So a strip that
     * fires on `sessions.length > 1` alone offers a control that changes
     * nothing on ~98% of the rows that show it, and invites a staff member to
     * click through tabs looking for a difference that is not there.
     */
    open(
      _row({
        sessions: [FC1, FC4],
        children: [
          { person_cm_id: 9001, display_name: 'Mia Garcia', session_cm_ids: [1309514, 1309517] },
          { person_cm_id: 9002, display_name: 'Noah Garcia', session_cm_ids: [1309514, 1309517] },
        ],
      })
    )

    expect(screen.queryByTestId('year-members-weekend-tabs')).toBeNull()
  })

  it('still shows the strip when ONE member differs on ONE weekend', () => {
    // The whole point of the strip, and the smallest case that needs it.
    open(
      _row({
        sessions: [FC1, FC4],
        children: [
          { person_cm_id: 9001, display_name: 'Mia Garcia', session_cm_ids: [1309514, 1309517] },
          { person_cm_id: 9002, display_name: 'Noah Garcia', session_cm_ids: [1309514] },
        ],
      })
    )

    expect(screen.getByTestId('year-members-weekend-tabs')).toBeInTheDocument()
  })

  it('shows no strip when every child’s weekends are unknown', () => {
    // An empty `session_cm_ids` means "not knowable", and such a child shows
    // on every tab — so the tabs would all render identically.
    open(
      _row({
        sessions: [FC1, FC4],
        children: [{ person_cm_id: 9001, display_name: 'Mia Garcia', session_cm_ids: [] }],
      })
    )

    expect(screen.queryByTestId('year-members-weekend-tabs')).toBeNull()
  })

  it('shows no tab strip when no weekend is knowable', () => {
    open(_row({ sessions: [] }))

    expect(screen.queryByTestId('year-members-weekend-tabs')).toBeNull()
  })

  it('keeps a child whose weekends are unknown visible on every tab', () => {
    // An attendee row whose `session` relation did not expand carries no
    // weekend. That is "not knowable", NOT "attended nothing" — hiding such a
    // child from every weekend tab would lose a real member of the party.
    //
    // A SECOND child with a known, incomplete list is what makes the strip
    // appear at all: an unknown-weekend child splits nothing by itself, so on
    // its own the tabs are suppressed entirely (see above). The guarantee
    // being pinned here is about what a tab SHOWS once one exists.
    open(
      _row({
        sessions: [FC1, FC4],
        children: [
          {
            person_cm_id: 1000003,
            display_name: 'Ava Garcia',
            last_name: 'Garcia',
            age: 10,
            grade: 5,
            session_cm_ids: [],
          },
          {
            person_cm_id: 1000004,
            display_name: 'Noah Garcia',
            last_name: 'Garcia',
            age: 8,
            grade: 3,
            session_cm_ids: [1309514],
          },
        ],
      })
    )

    fireEvent.click(screen.getByRole('button', { name: 'FC4' }))

    expect(screen.getByTestId('year-members-children').textContent).toContain('Ava Garcia')
  })
})
