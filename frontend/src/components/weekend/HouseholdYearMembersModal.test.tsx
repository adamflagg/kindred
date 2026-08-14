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
import { fireEvent, render, screen } from '@testing-library/react'
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
})

describe('a year with no enrolment on file', () => {
  it('says so instead of rendering a childless family', () => {
    open(
      _row({
        year: 2021,
        enrollment: 'none_on_file',
        children: [],
        adults: [{ adult_number: 1, display_name: 'Olivia Johnson', relationship: 'Parent' }],
      })
    )

    expect(screen.getByTestId('year-members-no-enrolment').textContent).toContain(
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

  it('does not claim a missing enrolment on a year that has one', () => {
    open(_row())

    expect(screen.queryByTestId('year-members-no-enrolment')).not.toBeInTheDocument()
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

  it('closes the dialog, empties the overlay stack, and clears background inert on click', () => {
    renderAtWeekendRoute()

    // Sanity: the dialog is actually open and registered before the click —
    // otherwise the assertions below would trivially pass on an unmounted
    // modal that never mounted in the first place.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.getElementById('root')).toHaveAttribute('inert')
    expect(hasOpenModal()).toBe(true)

    fireEvent.click(screen.getByRole('link', { name: /Emma Johnson/ }))

    // Real navigation happened — proves this isn't just `onClose` firing
    // while still parked on the weekend route.
    expect(screen.getByTestId('camper-page')).toBeInTheDocument()

    // The unwind: the stack must not believe a modal is still mounted once
    // the route has moved on, or the NEXT overlay opened anywhere in the
    // app inherits a stuck `inert` background / wrong Escape ownership.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.getElementById('root')).not.toHaveAttribute('inert')
    expect(hasOpenModal()).toBe(false)
  })
})
