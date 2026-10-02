import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HouseholdTotals } from './HouseholdTotals'

const NOTES: Record<string, number> = { cost: 1, decided: 2, grants: 3, family_share: 4, posted: 5 }
const numberOf = (key: string) => NOTES[key] ?? null

describe('HouseholdTotals (D77; household-totals.html B2)', () => {
  it("shows cost − aid, decided − grants = family's share, then Posted with its states", () => {
    render(
      <HouseholdTotals
        totals={{
          cost: 13520,
          decided: 3220,
          grants: 1000,
          family_share: 9300,
          posted: 1800,
          states: [{ status: 'short', count: 1, gap: -210 }],
        }}
        numberOf={numberOf}
      />
    )
    for (const figure of ['$13,520', '$3,220', '$1,000', '$9,300', '$1,800']) {
      expect(screen.getByText(figure)).toBeInTheDocument()
    }
    expect(screen.getByText("family's share").nextSibling).toHaveTextContent('4')
    expect(screen.getByText('posted · 1 short $210')).toBeInTheDocument()
  })

  it('reads "—" for a figure not there yet, never "$0" (D74; Review Focus 5)', () => {
    render(
      <HouseholdTotals
        totals={{
          cost: null,
          decided: 1420,
          grants: null,
          family_share: null,
          posted: null,
          states: [],
        }}
        numberOf={() => null}
      />
    )
    expect(screen.getAllByText('—')).toHaveLength(4)
    expect(screen.queryByText('$0')).toBeNull()
  })

  it("draws no equation the figures don't satisfy: the share is floored per request (⚠ Decision 38's interim)", () => {
    // $10,000 − $8,000 − $3,000 is not $500: one request's grants and aid passed its cost.
    render(
      <HouseholdTotals
        totals={{
          cost: 10000,
          decided: 8000,
          grants: 3000,
          family_share: 500,
          posted: null,
          states: [],
        }}
        numberOf={() => null}
      />
    )
    expect(screen.queryByText('−')).toBeNull()
    expect(screen.queryByText('=')).toBeNull()
    expect(screen.getAllByText('·')).toHaveLength(3)
  })
})
