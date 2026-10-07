import { describe, expect, it } from 'vitest'

import { BUDGET } from './budgetFixtures'
import {
  belowSummary,
  demandSummary,
  HOW_BODY,
  HOW_NO_RULES,
  HOW_SUMMARY,
  howLabel,
  notesLabel,
  parseOpenKeys,
  standsSummary,
  toggleOpenKey,
  typesSummary,
} from './foldLinesModel'

describe('fold state in the URL (spec §5.2 G)', () => {
  it('keeps budget, pool keys and lines:* in ?open=', () => {
    expect([...parseOpenKeys('budget,pool_a,lines:how')]).toEqual(['budget', 'pool_a', 'lines:how'])
    expect(toggleOpenKey(new Set(['budget']), 'budget')).toBeNull()
    expect(toggleOpenKey(new Set(['budget']), 'lines:notes')).toBe('budget,lines:notes')
  })
})

describe('the fold lines (spec §5.2 F)', () => {
  it('says how the rules count, without the ruling number', () => {
    expect(howLabel(3)).toBe('How rules v3 count')
    expect(howLabel(null)).toBe('How the rules count')
    expect(HOW_SUMMARY).toBe(
      'counts when offered · each pool keeps its own Remaining · only the total is a cap'
    )
    expect(HOW_BODY).not.toContain('D119')
    expect(HOW_BODY.endsWith('Round 3 is whatever is left in the pool.')).toBe(true)
    expect(HOW_NO_RULES).toBe('No approved rules: no total, no program split, nothing allocated.')
  })

  it('sums each round in the stands summary', () => {
    expect(standsSummary(BUDGET.strip)).toBe(
      'needs an offer 13 req · pending approval 1 req · held 11 req · posted Round 1 367, Round 2 23, Round 3 6 req'
    )
  })

  it('names outside grants, each outside-budget type and the held requests', () => {
    expect(belowSummary(BUDGET, null)).toBe(
      'outside grants $49,700 · Funded outside the budget $21,840 · 10 held req'
    )
  })

  it('says the demand still to come', () => {
    expect(demandSummary(BUDGET.total)).toBe(
      'Round 2 asks so far $34,700 (33 req) · Round 1 unmet ask $55,220 (47 req)'
    )
  })

  it('lists each counting type by its own money, then no named type', () => {
    expect(typesSummary(BUDGET.total)).toBe(
      'Standard award $14,400 · Appeal $4,200 · no named type $1,200'
    )
  })

  it('numbers the notes line', () => {
    expect(notesLabel(13)).toBe('Notes 1–13')
  })
})

describe('belowSummary scope (mutation guard)', () => {
  it('a one-pool summary leaves the no-request outside grants out', () => {
    expect(belowSummary(BUDGET, 'pool_b')).toBe('outside grants $3,100 · 1 held req')
  })
})
