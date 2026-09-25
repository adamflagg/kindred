import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { PartyRequestSections } from './PartyRequestSections'

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: false, permissions: [], hasPermission: () => false }),
}))
vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
}))

const household: RosterPartyRow = {
  grain: 'household',
  household_cm_id: 1000001,
  display_name: 'Johnson',
  share: { preference: 'yes_share' },
  flags: { needs_power: true },
}

describe('PartyRequestSections', () => {
  it('draws Share request then Housing needs for a household', () => {
    render(<PartyRequestSections party={household} year={2026} householdCmId={1000001} />)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Share request', 'Housing needs'])
  })
})

const guest: RosterPartyRow = {
  grain: 'person',
  household_cm_id: 0,
  person_cm_id: 1000004,
  display_name: 'Olivia Chen',
  flags: { needs_power: true },
  bunking_request: { state: 'request', current_text: 'Emma Johnson' },
}

describe('PartyRequestSections — adult guest (kindred#2759)', () => {
  it('draws Bunking request (Jotform) BEFORE Housing needs (Registration)', () => {
    render(<PartyRequestSections party={guest} year={2026} householdCmId={0} sessionType="adult" />)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Bunking request (Jotform)', 'Housing needs (Registration)'])
  })

  it('omits the Jotform section when the payload withholds it, and never shows "Share request"', () => {
    render(
      <PartyRequestSections
        party={{ ...guest, bunking_request: null }}
        year={2026}
        householdCmId={0}
        sessionType="adult"
      />
    )
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Housing needs (Registration)'])
  })

  it('keeps the family sections unless the WEEKEND is adult, whatever the grain', () => {
    render(<PartyRequestSections party={guest} year={2026} householdCmId={0} />)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Share request', 'Housing needs'])
  })
})
