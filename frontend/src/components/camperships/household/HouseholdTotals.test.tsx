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
    // The equation is drawn, to the cent: 13,520 - 3,220 - 1,000 = 9,300.
    expect(screen.getAllByText('−')).toHaveLength(2)
    expect(screen.getByText('=')).toBeInTheDocument()
    expect(screen.queryByText('·')).toBeNull()
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

  it('draws "·" and no equation while the share is not there yet (regression guard)', () => {
    render(
      <HouseholdTotals
        totals={{
          cost: 10000,
          decided: 8000,
          grants: 1000,
          family_share: null,
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
  describe('grants applied (Decision 38(b), #2941)', () => {
    const base = { posted: null, states: [] }

    it('labels the third figure "grants applied" and draws the equation when it adds up to the cent (a floored share)', () => {
      // 10,000 - 8,000 - 2,000 = 0: grants beyond what was owed are not in grants_applied.
      render(
        <HouseholdTotals
          totals={{
            ...base,
            cost: 10000,
            decided: 8000,
            grants: 3000,
            grants_applied: 2000,
            grants_beyond_owed: 1000,
            family_share: 0,
          }}
          numberOf={numberOf}
        />
      )
      expect(screen.getByText('grants applied')).toBeInTheDocument()
      expect(screen.queryByText('grants')).toBeNull()
      expect(screen.getByText('$2,000')).toBeInTheDocument()
      expect(screen.queryByText('$3,000')).toBeNull()
      expect(screen.getAllByText('−')).toHaveLength(2)
      expect(screen.getByText('=')).toBeInTheDocument()
      expect(screen.queryByText('·')).toBeNull()
      expect(screen.getByText('grants applied').nextSibling).toHaveTextContent('3')
    })

    it('keeps "·" when grants_applied is present but the figures do not add up (one request aid alone passes its cost)', () => {
      render(
        <HouseholdTotals
          totals={{
            ...base,
            cost: 10000,
            decided: 8000,
            grants: 2000,
            grants_applied: 2000,
            grants_beyond_owed: 0,
            family_share: 500,
          }}
          numberOf={numberOf}
        />
      )
      expect(screen.getByText('grants applied')).toBeInTheDocument()
      expect(screen.queryByText('−')).toBeNull()
      expect(screen.queryByText('=')).toBeNull()
      expect(screen.getAllByText('·')).toHaveLength(3)
    })

    it('says "+$X in grants beyond what was owed" only when it is above zero', () => {
      const totals = {
        ...base,
        cost: 10000,
        decided: 8000,
        grants: 3000,
        grants_applied: 2000,
        family_share: 0,
      }
      const { rerender } = render(
        <HouseholdTotals totals={{ ...totals, grants_beyond_owed: 1000 }} numberOf={numberOf} />
      )
      expect(screen.getByText('+$1,000 in grants beyond what was owed')).toBeInTheDocument()
      rerender(
        <HouseholdTotals totals={{ ...totals, grants_beyond_owed: 0 }} numberOf={numberOf} />
      )
      expect(screen.queryByText(/beyond what was owed/)).toBeNull()
      rerender(
        <HouseholdTotals totals={{ ...totals, grants_beyond_owed: null }} numberOf={numberOf} />
      )
      expect(screen.queryByText(/beyond what was owed/)).toBeNull()
    })

    it('reads "aid, decided so far" while some request is undecided, else "aid, decided"', () => {
      const totals = {
        ...base,
        cost: 10000,
        decided: 4000,
        grants: 1000,
        grants_applied: 1000,
        family_share: 5000,
      }
      const { rerender } = render(
        <HouseholdTotals totals={{ ...totals, decided_partial: true }} numberOf={numberOf} />
      )
      expect(screen.getByText('aid, decided so far')).toBeInTheDocument()
      rerender(
        <HouseholdTotals totals={{ ...totals, decided_partial: false }} numberOf={numberOf} />
      )
      expect(screen.getByText('aid, decided')).toBeInTheDocument()
      expect(screen.queryByText('aid, decided so far')).toBeNull()
    })

    it('leaves the interim untouched when the fields are absent or null (older server)', () => {
      render(
        <HouseholdTotals
          totals={{
            ...base,
            cost: 10000,
            decided: 8000,
            grants: 3000,
            grants_applied: null,
            family_share: 500,
          }}
          numberOf={numberOf}
        />
      )
      expect(screen.getByText('grants')).toBeInTheDocument()
      expect(screen.queryByText('grants applied')).toBeNull()
      expect(screen.getByText('$3,000')).toBeInTheDocument()
      expect(screen.getAllByText('·')).toHaveLength(3)
    })
  })
})
