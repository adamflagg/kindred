/** The counts strip must be honest about what it does not know. */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RosterCountSummary } from '../../types/lodging'
import { RosterHealthBanner } from './RosterHealthBanner'

function counts(overrides: Partial<RosterCountSummary> = {}): RosterCountSummary {
  return {
    parties_total: 0,
    parties_assigned: 0,
    parties_unassigned: 0,
    units_total: 0,
    units_family_available: 0,
    units_reserved: 0,
    beds_family_available: 0,
    units_capacity_unknown: 0,
    units_unconfirmed: 0,
    units_missing_allocation: 0,
    unresolved_aliases: 0,
    ...overrides,
  }
}

describe('RosterHealthBanner', () => {
  it('shows assigned vs unassigned parties', () => {
    render(
      <RosterHealthBanner
        counts={counts({ parties_total: 60, parties_assigned: 42, parties_unassigned: 18 })}
      />
    )
    expect(screen.getByText('42 of 60 placed')).toBeInTheDocument()
    expect(screen.getByText('18 unplaced')).toBeInTheDocument()
  })

  it('states that reserved units are excluded from availability', () => {
    render(
      <RosterHealthBanner
        counts={counts({ units_total: 82, units_family_available: 74, units_reserved: 8 })}
      />
    )
    expect(screen.getByText('74 of 82 units open to families')).toBeInTheDocument()
    expect(screen.getByText('8 reserved (excluded)')).toBeInTheDocument()
  })

  it('qualifies the bed total when some capacities are unknown', () => {
    render(
      <RosterHealthBanner
        counts={counts({ beds_family_available: 389, units_capacity_unknown: 6 })}
      />
    )
    expect(screen.getByText('389+ beds available')).toBeInTheDocument()
    expect(screen.getByText('6 units with unknown capacity')).toBeInTheDocument()
  })

  it('does not add a plus sign when every capacity is known', () => {
    render(
      <RosterHealthBanner
        counts={counts({ beds_family_available: 389, units_capacity_unknown: 0 })}
      />
    )
    expect(screen.getByText('389 beds available')).toBeInTheDocument()
  })

  it('surfaces unresolved aliases and unconfirmed amenities as warnings', () => {
    render(<RosterHealthBanner counts={counts({ unresolved_aliases: 3, units_unconfirmed: 11 })} />)
    expect(screen.getByText('3 unresolved cabin names')).toBeInTheDocument()
    expect(screen.getByText('11 units with unconfirmed amenities')).toBeInTheDocument()
  })

  it('surfaces units created without an allocation default', () => {
    render(<RosterHealthBanner counts={counts({ units_missing_allocation: 2 })} />)
    expect(screen.getByText('2 units missing an allocation default')).toBeInTheDocument()
  })

  it('shows no warnings when the registry is clean', () => {
    render(<RosterHealthBanner counts={counts()} />)
    expect(screen.queryByText(/unresolved cabin names/)).not.toBeInTheDocument()
    expect(screen.queryByText(/unconfirmed amenities/)).not.toBeInTheDocument()
  })

  it('treats absent count fields as zero rather than rendering undefined', () => {
    // Pydantic fields with a default render as OPTIONAL in TypeScript. The
    // server always populates them, but a partial payload must not leak
    // "undefined" into the strip.
    render(<RosterHealthBanner counts={{}} />)
    expect(screen.getByText('0 of 0 placed')).toBeInTheDocument()
    expect(screen.getByText('0 beds available')).toBeInTheDocument()
  })
})
