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
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { HouseholdJourneyRow } from '../../types/lodging'
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

function open(row: HouseholdJourneyRow | null, familyLabel = 'The Johnson Family') {
  return render(
    <HouseholdYearMembersModal isOpen onClose={vi.fn()} row={row} familyLabel={familyLabel} />
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
