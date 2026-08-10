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
    units_reserved: 3,
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

  it('notes written-into cabins as excluded from the space count', () => {
    // "held" until kindred#2078. Staff never used the control to reserve an
    // empty room -- they used it to write in an occupant -- so the old word
    // described the opposite of what the number counts.
    render(<WeekendStatsBar counts={counts()} bedsNeeded={223} spacesUnmeasured={0} />)
    expect(screen.getByText('· 3 write-ins')).toBeInTheDocument()
  })

  it('does not describe written-into cabins as staff housing', () => {
    // The two were one number until units_staff_housing split them, and the
    // tooltip still said "Held for staff". They are different facts with
    // different remedies: a written-into cabin comes back next weekend, a
    // staff cabin never does.
    render(<WeekendStatsBar counts={counts()} bedsNeeded={223} spacesUnmeasured={0} />)
    const writeIns = screen.getByRole('button', { name: '3 write-ins' })
    expect(writeIns).toHaveAccessibleDescription(/excluded from family spaces/i)
    expect(writeIns).not.toHaveAccessibleDescription(/staff/i)
  })

  it('puts the spaces, write-in and staff notes on tooltips keyboard and touch can reach', () => {
    // kindred#2177: all three were bare `title` attributes on a `<span>`.
    render(
      <WeekendStatsBar
        counts={counts({ units_staff_housing: 21 })}
        bedsNeeded={223}
        spacesUnmeasured={0}
      />
    )
    // Each figure names its own unit. Making these tab stops turned three
    // bare numerals into three buttons called "79", "3" and "21" — the word
    // that says what is counted lives in a sibling `<span>` the accessible
    // name cannot see. The visible text is kept INSIDE each label so the
    // name still contains it (WCAG 2.5.3).
    const spaces = screen.getByRole('button', { name: '79 spaces' })
    expect(spaces).not.toHaveAttribute('title')
    expect(spaces).toHaveAccessibleDescription(/Merging or splitting cabins/i)
    fireEvent.focus(spaces)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Merging or splitting cabins/i)

    expect(screen.getByRole('button', { name: '21 staff cabins' })).toHaveAccessibleDescription(
      /never part of the weekend/i
    )
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
})
