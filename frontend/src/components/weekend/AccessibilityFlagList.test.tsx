/**
 * Accessibility flags are derived booleans, and that is now ALL this
 * component is.
 *
 * It used to carry the medical narrative too, behind a click-to-reveal gated
 * on `bunking.manage` (kindred#2312 retargeted the gate from the now-removed
 * `lodging.phi`). kindred#1889 split that out: the narrative lives in
 * `MedicalNarrative`, which `FamilyDetailsPanel` renders and
 * `HouseholdRosterRow` does not. The reason is grain — the roster row is a
 * `<tr>` and 62 of them are on screen at once, while the panel shows one
 * household at a time, exactly the split summer makes between a camper card
 * and `CamperDetailsPanel`.
 *
 * What this file pins is the ABSENCE: no permission check, no fetch, no
 * state. A chips list that reaches for PHI is the thing that was wrong.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AccessibilityFlags } from '../../types/lodging'
import { AccessibilityFlagList } from './AccessibilityFlagList'

const useHouseholdMedical = vi.fn(() => ({ data: undefined, isLoading: false, error: null }))

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: (...args: unknown[]) => useHouseholdMedical(...(args as [])),
}))

function flags(overrides: Partial<AccessibilityFlags> = {}): AccessibilityFlags {
  return {
    needs_private_bathroom: false,
    needs_power: false,
    needs_accommodation: false,
    accommodation_is_mandatory: false,
    has_infant: false,
    ...overrides,
  }
}

describe('derived flags', () => {
  it('renders the private-bathroom need', () => {
    render(<AccessibilityFlagList flags={flags({ needs_private_bathroom: true })} />)
    expect(screen.getByText('Private bathroom')).toBeInTheDocument()
  })

  it('renders the power need (CPAP)', () => {
    render(<AccessibilityFlagList flags={flags({ needs_power: true })} />)
    expect(screen.getByText('Power')).toBeInTheDocument()
  })

  it('treats power and private bathroom as INDEPENDENT needs', () => {
    // The CPAP / adult-infant source fields are multi-option, not boolean, and
    // one option carries both needs. A household can need power without a
    // private bathroom and vice versa; neither implies the other.
    render(
      <AccessibilityFlagList flags={flags({ needs_power: true, needs_private_bathroom: false })} />
    )
    expect(screen.getByText('Power')).toBeInTheDocument()
    expect(screen.queryByText('Private bathroom')).not.toBeInTheDocument()
  })

  it('renders the infant flag', () => {
    render(<AccessibilityFlagList flags={flags({ has_infant: true })} />)
    expect(screen.getByText('Infant in party')).toBeInTheDocument()
  })

  it('distinguishes a mandatory accommodation from a preference', () => {
    const { rerender } = render(
      <AccessibilityFlagList
        flags={flags({ needs_accommodation: true, accommodation_is_mandatory: true })}
      />
    )
    expect(screen.getByText('Accommodation required')).toBeInTheDocument()

    rerender(
      <AccessibilityFlagList
        flags={flags({ needs_accommodation: true, accommodation_is_mandatory: false })}
      />
    )
    expect(screen.getByText('Accommodation requested')).toBeInTheDocument()
  })

  it('renders nothing when no flag is set', () => {
    const { container } = render(<AccessibilityFlagList flags={flags()} />)
    expect(container.textContent).toBe('')
  })
})

describe('the medical narrative is not this component', () => {
  it('never fetches PHI', () => {
    // The strongest form of the split. This component is rendered 62 times on
    // a roster page; if it can reach the PHI hook at all, a later change can
    // make 62 gated requests by accident.
    useHouseholdMedical.mockClear()
    render(<AccessibilityFlagList flags={flags({ needs_power: true })} />)
    expect(useHouseholdMedical).not.toHaveBeenCalled()
  })

  it('renders no medical affordance', () => {
    render(<AccessibilityFlagList flags={flags({ needs_power: true })} />)
    expect(screen.queryByRole('button', { name: /medical/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/medical detail/i)).not.toBeInTheDocument()
  })
})
