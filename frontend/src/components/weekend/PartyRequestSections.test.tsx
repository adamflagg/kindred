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
