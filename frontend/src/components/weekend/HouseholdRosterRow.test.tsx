/**
 * `HouseholdRosterRow` renders once per roster row, 62 to a page — it must
 * never acquire the medical hook, because 62 rows would fire 62 gated
 * requests. This is the request-volume boundary `HousingNeedDetails`'s own
 * doc comment describes; this suite pins the roster side of it.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { HouseholdRosterRow } from './HouseholdRosterRow'

const medicalCalls: unknown[][] = []

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: (...args: unknown[]) => {
    medicalCalls.push(args)
    return { data: undefined, isLoading: false, error: null }
  },
}))

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 1000001,
    display_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 9001, display_name: 'Liam Johnson', last_name: 'Johnson', age: 8 }],
    party_size: 2,
    flags: { needs_private_bathroom: true },
    ...overrides,
  }
}

describe('HouseholdRosterRow', () => {
  it('issues no medical request, under any permission', () => {
    render(
      <table>
        <tbody>
          <HouseholdRosterRow party={party()} showRequests={true} onOpen={vi.fn()} />
        </tbody>
      </table>
    )

    expect(medicalCalls).toHaveLength(0)
    // A row that rendered nothing would also leave `medicalCalls` empty --
    // that failure mode makes the assertion above worthless on its own. This
    // confirms the row actually drew its housing-needs chip from the flags
    // it was handed directly, with no fetch behind it.
    expect(screen.getByText('Bathroom in unit')).toBeInTheDocument()
  })
})
