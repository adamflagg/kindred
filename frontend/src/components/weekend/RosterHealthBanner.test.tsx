/**
 * The counts strip must be honest about what it does not know — and it must
 * not cry wolf.
 *
 * Measured on real 2026 data, `units_unconfirmed` is 82 of 82: a warning that
 * is always on is not a warning, it is a description of the registry. The
 * banner therefore says a different thing when a signal is universal than when
 * it is exceptional.
 */
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

describe('placement figures', () => {
  it('shows placed against total, and what still needs a cabin', () => {
    render(
      <RosterHealthBanner
        counts={counts({ parties_total: 60, parties_assigned: 42, parties_unassigned: 18 })}
        bedsNeeded={231}
      />
    )
    expect(screen.getByText('42 of 60 placed')).toBeInTheDocument()
    expect(screen.getByText('18 still need a cabin')).toBeInTheDocument()
  })

  it('says the weekend is fully placed rather than showing a zero', () => {
    render(
      <RosterHealthBanner
        counts={counts({ parties_total: 60, parties_assigned: 60, parties_unassigned: 0 })}
        bedsNeeded={231}
      />
    )
    expect(screen.getByText('Everyone has a cabin')).toBeInTheDocument()
  })

  it('does not claim success on a weekend nobody has registered for', () => {
    render(
      <RosterHealthBanner
        counts={counts({ parties_total: 0, parties_assigned: 0, parties_unassigned: 0 })}
        bedsNeeded={0}
      />
    )
    expect(screen.getByText('No one enrolled yet')).toBeInTheDocument()
    expect(screen.queryByText('Everyone has a cabin')).not.toBeInTheDocument()
  })

  it('states that held cabins are excluded from the beds above', () => {
    render(
      <RosterHealthBanner
        counts={counts({ units_total: 82, units_family_available: 79, units_reserved: 3 })}
        bedsNeeded={231}
      />
    )
    expect(screen.getByText('79 of 82 cabins open to families')).toBeInTheDocument()
    expect(screen.getByText('3 held for staff, not counted above')).toBeInTheDocument()
  })

  it('omits the held-cabin line when nothing is held', () => {
    render(
      <RosterHealthBanner
        counts={counts({ units_total: 82, units_family_available: 82, units_reserved: 0 })}
        bedsNeeded={231}
      />
    )
    expect(screen.queryByText(/held for staff/)).not.toBeInTheDocument()
  })
})

describe('capacity', () => {
  it('hands the bed figures to the ledger', () => {
    render(
      <RosterHealthBanner
        counts={counts({ beds_family_available: 389, units_capacity_unknown: 5 })}
        bedsNeeded={231}
      />
    )
    expect(screen.getByText('231')).toBeInTheDocument()
    expect(screen.getByText('of 389 available')).toBeInTheDocument()
    expect(screen.getByText('5 cabins unmeasured')).toBeInTheDocument()
  })

  it('does not repeat unknown capacity as a registry note', () => {
    // The ledger already carries it as a band. Saying it twice trains staff
    // to ignore the notes row.
    render(
      <RosterHealthBanner
        counts={counts({ beds_family_available: 389, units_capacity_unknown: 5 })}
        bedsNeeded={231}
      />
    )
    expect(screen.queryByText(/units with unknown capacity/)).not.toBeInTheDocument()
  })
})

describe('registry notes', () => {
  it('describes a wholly unconfirmed registry as a state, not a warning', () => {
    render(
      <RosterHealthBanner
        counts={counts({ units_total: 82, units_unconfirmed: 82 })}
        bedsNeeded={0}
      />
    )
    expect(screen.getByText('No cabin amenities confirmed yet')).toBeInTheDocument()
    expect(screen.queryByText(/82 cabins have unconfirmed/)).not.toBeInTheDocument()
  })

  it('counts unconfirmed amenities when only some are outstanding', () => {
    render(
      <RosterHealthBanner
        counts={counts({ units_total: 82, units_unconfirmed: 11 })}
        bedsNeeded={0}
      />
    )
    expect(screen.getByText('11 of 82 cabins have unconfirmed amenities')).toBeInTheDocument()
  })

  it('surfaces cabin names the ingest could not map', () => {
    render(<RosterHealthBanner counts={counts({ unresolved_aliases: 3 })} bedsNeeded={0} />)
    expect(screen.getByText('3 cabin names need mapping')).toBeInTheDocument()
  })

  it('surfaces cabins created without an allocation default', () => {
    render(<RosterHealthBanner counts={counts({ units_missing_allocation: 2 })} bedsNeeded={0} />)
    expect(screen.getByText('2 cabins have no allocation default')).toBeInTheDocument()
  })

  it('shows no notes at all when the registry is clean', () => {
    render(
      <RosterHealthBanner
        counts={counts({ units_total: 82, units_unconfirmed: 0 })}
        bedsNeeded={231}
      />
    )
    expect(screen.queryByText(/need mapping/)).not.toBeInTheDocument()
    expect(screen.queryByText(/unconfirmed/)).not.toBeInTheDocument()
    expect(screen.queryByText(/allocation default/)).not.toBeInTheDocument()
  })
})

describe('missing fields', () => {
  it('treats absent count fields as zero rather than rendering undefined', () => {
    render(<RosterHealthBanner counts={{}} bedsNeeded={0} />)
    expect(screen.getByText('0 of 0 placed')).toBeInTheDocument()
    expect(screen.getByText('of 0 available')).toBeInTheDocument()
  })
})
