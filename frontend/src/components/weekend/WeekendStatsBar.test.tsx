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
    beds_family_available: 389,
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
      <WeekendStatsBar counts={counts()} bedsNeeded={223} spacesUnmeasured={2} />
    )
    expect(container.firstElementChild).toHaveClass('border-border/50', 'border-b', 'py-2.5')
    expect(container.firstElementChild?.firstElementChild).toHaveClass('min-h-10', 'text-sm')
  })

  it('reports placement as assigned over total', () => {
    render(<WeekendStatsBar counts={counts()} bedsNeeded={223} spacesUnmeasured={2} />)
    expect(screen.getByText('56')).toBeInTheDocument()
    expect(screen.getByText('/62')).toBeInTheDocument()
    expect(screen.getByText('placed')).toBeInTheDocument()
  })

  it('leads capacity with spaces and their spare count', () => {
    render(<WeekendStatsBar counts={counts()} bedsNeeded={223} spacesUnmeasured={2} />)
    expect(screen.getByText('79')).toBeInTheDocument()
    expect(screen.getByText('spaces')).toBeInTheDocument()
    expect(screen.getByText('(17 spare)')).toBeInTheDocument()
  })

  it('says short, not negative spare, when families outnumber spaces', () => {
    render(
      <WeekendStatsBar
        counts={counts({ parties_total: 85 })}
        bedsNeeded={300}
        spacesUnmeasured={0}
      />
    )
    expect(screen.getByText('(6 short)')).toBeInTheDocument()
  })

  it('keeps beds on the bar without letting them lead', () => {
    render(<WeekendStatsBar counts={counts()} bedsNeeded={223} spacesUnmeasured={2} />)
    expect(screen.getByText('223')).toBeInTheDocument()
    expect(screen.getByText('/389')).toBeInTheDocument()
    expect(screen.getByText('beds')).toBeInTheDocument()
  })

  it('reports unmeasured spaces beside the beds they are missing from', () => {
    render(<WeekendStatsBar counts={counts()} bedsNeeded={223} spacesUnmeasured={2} />)
    expect(screen.getByText('(2 unmeasured spaces)')).toBeInTheDocument()
  })

  it('singularises a lone unmeasured space', () => {
    render(<WeekendStatsBar counts={counts()} bedsNeeded={223} spacesUnmeasured={1} />)
    expect(screen.getByText('(1 unmeasured space)')).toBeInTheDocument()
  })

  it('does not draw a write-ins chip', () => {
    // Struck 2026-08-21 (kindred#2503). Its tooltip said write-ins were
    // "excluded from family spaces", which stopped being true the moment a
    // sized write-in left the cabin available. The owner ruled the chip is not
    // wanted rather than reworded.
    //
    // This only pins what it can: the rendered bar carries no "write-ins"
    // text, and `units_staff_housing`'s chip beside it -- a different fact
    // with a different remedy, which is why the two were split in the first
    // place -- is untouched. It does NOT prove restoring the deleted chip
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
        bedsNeeded={0}
        spacesUnmeasured={0}
      />
    )
    expect(screen.queryByText(/write-ins/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('3 staff cabins')).toBeInTheDocument()
  })

  it('puts the spaces and staff notes on tooltips keyboard and touch can reach', () => {
    // kindred#2177: both were bare `title` attributes on a `<span>`.
    render(
      <WeekendStatsBar
        counts={counts({ units_staff_housing: 21 })}
        bedsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    // Each figure names its own unit. Making these tab stops turned two
    // bare numerals into two buttons called "79" and "21" — the word that
    // says what is counted lives in a sibling `<span>` the accessible name
    // cannot see. The visible text is kept INSIDE each label so the name
    // still contains it (WCAG 2.5.3).
    const spaces = screen.getByRole('button', { name: '79 spaces' })
    expect(spaces).not.toHaveAttribute('title')
    fireEvent.focus(spaces)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Merging or splitting cabins/i)

    const staffCabins = screen.getByRole('button', { name: '21 staff cabins' })
    fireEvent.blur(spaces)
    fireEvent.focus(staffCabins)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/never part of the weekend/i)
  })

  it('reports staff housing separately, because it was never inventory', () => {
    // 21 cabins reading as write-ins would say staff took them out of service
    // this weekend. They were never in service.
    render(
      <WeekendStatsBar
        counts={counts({ units_staff_housing: 21 })}
        bedsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    expect(screen.getByText('· 21 staff')).toBeInTheDocument()
  })

  it('says nothing about staff housing when there is none', () => {
    render(<WeekendStatsBar counts={counts()} bedsNeeded={223} spacesUnmeasured={0} />)
    expect(screen.queryByText(/staff/)).not.toBeInTheDocument()
  })

  it('highlights parties still needing a cabin', () => {
    render(<WeekendStatsBar counts={counts()} bedsNeeded={223} spacesUnmeasured={0} />)
    expect(screen.getByText('need a cabin')).toBeInTheDocument()
  })

  it('drops the needs-a-cabin figure when everyone is placed', () => {
    render(
      <WeekendStatsBar
        counts={counts({ parties_assigned: 62, parties_unassigned: 0 })}
        bedsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    expect(screen.queryByText('need a cabin')).not.toBeInTheDocument()
  })

  it('describes a wholly unconfirmed registry as a state, not a warning', () => {
    render(
      <WeekendStatsBar
        counts={counts({ units_total: 82, units_unconfirmed: 82 })}
        bedsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    expect(screen.getByText(/No cabin amenities confirmed yet/)).toBeInTheDocument()
  })

  it('counts unconfirmed amenities when only some are outstanding', () => {
    render(
      <WeekendStatsBar
        counts={counts({ units_total: 82, units_unconfirmed: 11 })}
        bedsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    expect(screen.getByText(/11 of 82 cabins have unconfirmed amenities/)).toBeInTheDocument()
  })

  it('surfaces unmapped cabin names and missing allocation defaults', () => {
    render(
      <WeekendStatsBar
        counts={counts({ unresolved_aliases: 3, units_missing_allocation: 2 })}
        bedsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    expect(screen.getByText(/3 cabin names need mapping/)).toBeInTheDocument()
    expect(screen.getByText(/2 cabins have no allocation default/)).toBeInTheDocument()
  })

  it('treats absent count fields as zero rather than rendering undefined', () => {
    render(<WeekendStatsBar counts={{}} bedsNeeded={0} spacesUnmeasured={0} />)
    expect(screen.getByText('(0 spare)')).toBeInTheDocument()
  })

  // The push entry (kindred#2477) rides in this slot rather than beside the
  // bar, because the bar owns the band's bottom rule: a control placed as a
  // SIBLING leaves that rule stopping short of it, which is what the owner
  // caught on the 2026-08-24 visual pass. Pinning containment is what stops a
  // later refactor from quietly hoisting it back out.
  it('renders a trailing control inside its own bordered row', () => {
    const { container } = render(
      <WeekendStatsBar
        counts={counts({})}
        bedsNeeded={0}
        spacesUnmeasured={0}
        trailing={<button type="button">Push write-ins</button>}
      />
    )
    const trailing = screen.getByRole('button', { name: 'Push write-ins' })
    const rule = container.querySelector('.border-b')
    expect(rule).not.toBeNull()
    expect(rule?.contains(trailing)).toBe(true)
  })

  it('renders no trailing wrapper when the slot is empty', () => {
    // Queried by NAME: the bar's own figures are tooltip buttons, so a bare
    // `queryByRole('button')` matches them and proves nothing about the slot.
    render(<WeekendStatsBar counts={counts({})} bedsNeeded={0} spacesUnmeasured={0} />)
    expect(screen.queryByRole('button', { name: 'Push write-ins' })).not.toBeInTheDocument()
  })
})
