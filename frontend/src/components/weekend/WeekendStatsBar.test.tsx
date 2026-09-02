/**
 * The contextual stats bar, in the summer session view's grammar.
 *
 * It must stay honest on the two things this domain gets wrong: spaces are the
 * capacity unit (not beds), and a note true of every cabin describes the
 * registry rather than warning about it.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RosterCountSummary } from '../../types/lodging'
import { WeekendStatsBar } from './WeekendStatsBar'

function counts(overrides: Partial<RosterCountSummary> = {}): RosterCountSummary {
  return {
    parties_total: 62,
    parties_assigned: 56,
    parties_unassigned: 6,
    units_total: 82,
    units_family_available: 79,
    spots_family_available: 389,
    units_capacity_unknown: 5,
    units_unconfirmed: 0,
    units_missing_allocation: 0,
    unresolved_aliases: 0,
    ...overrides,
  }
}

describe('WeekendStatsBar', () => {
  it('stands as tall as summer’s contextual bar', () => {
    // Both bars are `py-2.5` inside the same bottom border, but summer's holds
    // a segmented area control — a `p-1` box around `py-1.5` buttons, so 40px
    // — while this one holds a single line of `text-sm`, which is 20px. Same
    // padding, 20px shorter bar: that is the tightness, and it is why matching
    // the padding alone does not fix it.
    //
    // `min-h-10` buys back exactly the control's height without inventing a
    // control to fill it. Pinned because it reads as a stray utility otherwise
    // and is the first thing a tidy-up would drop.
    const { container } = render(
      <WeekendStatsBar counts={counts()} spotsNeeded={223} spacesUnmeasured={2} />
    )
    expect(container.firstElementChild).toHaveClass('border-border/50', 'border-b', 'py-2.5')
    expect(container.firstElementChild?.firstElementChild).toHaveClass('min-h-10', 'text-sm')
  })

  it('reports placement as assigned over total', () => {
    render(<WeekendStatsBar counts={counts()} spotsNeeded={223} spacesUnmeasured={2} />)
    expect(screen.getByText('56')).toBeInTheDocument()
    expect(screen.getByText('/62')).toBeInTheDocument()
    expect(screen.getByText('placed')).toBeInTheDocument()
  })

  it('leads capacity with spaces and their spare count', () => {
    render(<WeekendStatsBar counts={counts()} spotsNeeded={223} spacesUnmeasured={2} />)
    expect(screen.getByText('79')).toBeInTheDocument()
    expect(screen.getByText('spaces')).toBeInTheDocument()
    expect(screen.getByText('(17 spare)')).toBeInTheDocument()
  })

  it('says short, not negative spare, when families outnumber spaces', () => {
    render(
      <WeekendStatsBar
        counts={counts({ parties_total: 85 })}
        spotsNeeded={300}
        spacesUnmeasured={0}
      />
    )
    expect(screen.getByText('(6 short)')).toBeInTheDocument()
  })

  it('keeps beds on the bar without letting them lead', () => {
    render(<WeekendStatsBar counts={counts()} spotsNeeded={223} spacesUnmeasured={2} />)
    expect(screen.getByText('223')).toBeInTheDocument()
    expect(screen.getByText('/389')).toBeInTheDocument()
    expect(screen.getByText('beds')).toBeInTheDocument()
  })

  it('reports unmeasured spaces beside the beds they are missing from', () => {
    render(<WeekendStatsBar counts={counts()} spotsNeeded={223} spacesUnmeasured={2} />)
    expect(screen.getByText('(2 unmeasured spaces)')).toBeInTheDocument()
  })

  it('singularises a lone unmeasured space', () => {
    render(<WeekendStatsBar counts={counts()} spotsNeeded={223} spacesUnmeasured={1} />)
    expect(screen.getByText('(1 unmeasured space)')).toBeInTheDocument()
  })

  it('does not draw a write-ins chip', () => {
    // Struck 2026-08-21 (kindred#2503). Its tooltip said write-ins were
    // "excluded from family spaces", which stopped being true the moment a
    // sized write-in left the cabin available. The owner ruled the chip is not
    // wanted rather than reworded.
    //
    // This only pins what it can: the rendered bar carries no "write-ins"
    // text. It does NOT prove restoring the deleted chip
    // code would fail here: this fixture no longer sets `units_reserved`, so
    // a reintroduced `counts.units_reserved ?? 0` would read `0` and stay
    // silent. The real guard against that regression is the generated type:
    // `units_reserved` is gone from `types.gen.ts` (RosterCounts, the type
    // `RosterCountSummary` aliases) entirely, so restoring the chip's
    // `counts.units_reserved` read is a compile error under `tsc --noEmit`
    // -- caught in both pre-push and CI -- not a silent regression a unit
    // test would need to catch instead.
    render(
      <WeekendStatsBar
        counts={counts({ units_staff_housing: 3 })}
        spotsNeeded={0}
        spacesUnmeasured={0}
      />
    )
    expect(screen.queryByText(/write-ins/)).not.toBeInTheDocument()
  })

  it('puts the spaces note on a tooltip keyboard and touch can reach', () => {
    // kindred#2177: it was a bare `title` attribute on a `<span>`.
    render(<WeekendStatsBar counts={counts()} spotsNeeded={223} spacesUnmeasured={0} />)
    // The figure names its own unit. Making it a tab stop turned a bare
    // numeral into a button called "79" — the word that says what is
    // counted lives in a sibling `<span>` the accessible name cannot see.
    // The visible text is kept INSIDE the label so the name still contains
    // it (WCAG 2.5.3).
    const spaces = screen.getByRole('button', { name: '79 spaces' })
    expect(spaces).not.toHaveAttribute('title')
    fireEvent.focus(spaces)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Merging or splitting cabins/i)
  })

  it('draws no staff-housing count, however many staff cabins there are', () => {
    // Struck 2026-09-01. The fact was true and rarely acted on, and the bar
    // is where the weekend's row budget is spent: placed / spaces / beds, the
    // needs-a-cabin warning, the attribution chip and the right-aligned
    // Compare and Push write-ins controls were wrapping to two lines. Staff
    // housing still shows where it is worked with — the admin unit list, the
    // board's legend and the unit form's allocation field.
    render(
      <WeekendStatsBar
        counts={counts({ units_staff_housing: 21 })}
        spotsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    expect(screen.queryByText(/staff/)).not.toBeInTheDocument()
    expect(screen.queryByText('21')).not.toBeInTheDocument()
  })

  it('highlights parties still needing a cabin', () => {
    render(<WeekendStatsBar counts={counts()} spotsNeeded={223} spacesUnmeasured={0} />)
    expect(screen.getByText('need a cabin')).toBeInTheDocument()
  })

  it('drops the needs-a-cabin figure when everyone is placed', () => {
    render(
      <WeekendStatsBar
        counts={counts({ parties_assigned: 62, parties_unassigned: 0 })}
        spotsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    expect(screen.queryByText('need a cabin')).not.toBeInTheDocument()
  })

  it('describes a wholly unconfirmed registry as a state, not a warning', () => {
    render(
      <WeekendStatsBar
        counts={counts({ units_total: 82, units_unconfirmed: 82 })}
        spotsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    expect(screen.getByText(/No cabin amenities confirmed yet/)).toBeInTheDocument()
  })

  it('counts unconfirmed amenities when only some are outstanding', () => {
    render(
      <WeekendStatsBar
        counts={counts({ units_total: 82, units_unconfirmed: 11 })}
        spotsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    expect(screen.getByText(/11 of 82 cabins have unconfirmed amenities/)).toBeInTheDocument()
  })

  it('surfaces unmapped cabin names and missing allocation defaults', () => {
    render(
      <WeekendStatsBar
        counts={counts({ unresolved_aliases: 3, units_missing_allocation: 2 })}
        spotsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    expect(screen.getByText(/3 cabin names need mapping/)).toBeInTheDocument()
    expect(screen.getByText(/2 cabins have no allocation default/)).toBeInTheDocument()
  })

  it('treats absent count fields as zero rather than rendering undefined', () => {
    render(<WeekendStatsBar counts={{}} spotsNeeded={0} spacesUnmeasured={0} />)
    expect(screen.getByText('(0 spare)')).toBeInTheDocument()
  })

  // The cabin-weekend chip (kindred#2648 UI half, Q1 decided 2026-08-31):
  // inline in the stats bar's own row. It is the bar's ONLY slot since
  // 2026-09-02 — the `trailing` one that held the right-aligned Compare and
  // Push write-ins controls moved to the page header, where summer's
  // `SessionHeader` keeps its actions — so what is pinned here is containment
  // in the bar row, not order against a neighbour that no longer exists.
  it('renders the attribution chip inline, inside the bar row', () => {
    const { container } = render(
      <WeekendStatsBar
        counts={counts({})}
        spotsNeeded={0}
        spacesUnmeasured={0}
        attributionChip={<button type="button">4 cabins need a weekend</button>}
      />
    )
    const chip = screen.getByRole('button', { name: '4 cabins need a weekend' })
    expect(container.firstElementChild?.firstElementChild?.contains(chip)).toBe(true)
  })

  it('renders no attribution-chip wrapper when the slot is empty', () => {
    render(<WeekendStatsBar counts={counts({})} spotsNeeded={0} spacesUnmeasured={0} />)
    expect(screen.queryByRole('button', { name: /need.*a weekend/i })).not.toBeInTheDocument()
  })

  it('keeps the chip inside the bar rather than pushed right like an action', () => {
    // The chip is a FIGURE. It used to be pinned as sitting before the
    // right-aligned action group; with that group gone to the header, the
    // guarantee that still means something is that the chip never acquires
    // the `ml-auto` the group had — which is what would make it read as an
    // action parked at the far end of the row.
    const { container } = render(
      <WeekendStatsBar
        counts={counts({})}
        spotsNeeded={0}
        spacesUnmeasured={0}
        attributionChip={<button type="button">4 cabins need a weekend</button>}
      />
    )
    const chip = screen.getByRole('button', { name: '4 cabins need a weekend' })
    expect(container.querySelector('.ml-auto')).toBeNull()
    expect(chip.closest('.border-b')).not.toBeNull()
  })
})
