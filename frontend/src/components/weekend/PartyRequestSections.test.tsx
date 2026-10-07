import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { PartyRequestSections } from './PartyRequestSections'

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: false, permissions: [], hasPermission: () => false }),
}))
vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
  usePersonNeedNarrative: () => ({ data: undefined, isLoading: false, error: null }),
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

  it('draws no empty Housing needs heading for a household with no needs', () => {
    render(
      <PartyRequestSections
        party={{ ...household, flags: {} }}
        year={2026}
        householdCmId={1000001}
      />
    )
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Share request'])
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
  it('draws Bunking request (Jotform) BEFORE Housing needs', () => {
    // Owner ruling 2026-10-07: "Housing needs", as on the family panel. Every
    // row carries its own Registration / Jotform tag now that both sit here.
    render(<PartyRequestSections party={guest} year={2026} householdCmId={0} sessionType="adult" />)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Bunking request (Jotform)', 'Housing needs'])
  })

  it('draws no empty Housing needs heading for a guest with nothing to show', () => {
    render(
      <PartyRequestSections
        party={{ ...guest, flags: {} }}
        year={2026}
        householdCmId={0}
        sessionType="adult"
      />
    )
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Bunking request (Jotform)'])
  })

  it('shows a guest’s Jotform accommodation comment with no registration need', () => {
    render(
      <PartyRequestSections
        party={{
          ...guest,
          flags: {},
          bunking_request: {
            state: 'none',
            accommodation: {
              answer: 'No',
              registration: 'No',
              details: 'Light sleeper, a quiet cabin please',
              submitted_at: '2026-09-10 09:00:00',
            },
          },
        }}
        year={2026}
        householdCmId={0}
        sessionType="adult"
      />
    )
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Bunking request (Jotform)', 'Housing needs'])
    expect(screen.getByTestId('jotform-details-accommodation')).toHaveTextContent(
      'Light sleeper, a quiet cabin please'
    )
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
    expect(headings).toEqual(['Housing needs'])
  })

  it('keeps the family sections unless the WEEKEND is adult, whatever the grain', () => {
    render(<PartyRequestSections party={guest} year={2026} householdCmId={0} />)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Share request', 'Housing needs'])
  })
})
