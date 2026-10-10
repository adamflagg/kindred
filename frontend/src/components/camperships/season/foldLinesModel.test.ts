import { describe, expect, it } from 'vitest'

import { BUDGET } from './budgetFixtures'
import {
  belowSummary,
  budgetDescription,
  demandSummary,
  HOW_SUMMARY,
  openKeys,
  parseOpenKeys,
  standsSummary,
  toggleOpenKey,
  typesSummary,
} from './foldLinesModel'

describe('fold state in the URL (spec §5.2 G)', () => {
  it('keeps pool keys and lines:* in ?open=', () => {
    expect([...parseOpenKeys('pool_a,lines:stands')]).toEqual(['pool_a', 'lines:stands'])
    expect([...parseOpenKeys('')]).toEqual([])
  })

  it('starts on the defaults (the pools and Where each round stands) until a toggle writes ?open=', () => {
    expect([...openKeys(null, ['pool_a', 'lines:stands'])]).toEqual(['pool_a', 'lines:stands'])
    // a present ?open= is the whole state, an empty one meaning "all closed"
    expect([...openKeys('', ['pool_a', 'lines:stands'])]).toEqual([])
    expect([...openKeys('lines:below', ['pool_a'])]).toEqual(['lines:below'])
  })

  it('writes the whole next state, "" when everything is closed', () => {
    expect(toggleOpenKey(new Set(['pool_a']), 'pool_a')).toBe('')
    expect(toggleOpenKey(new Set(['pool_a']), 'lines:below')).toBe('pool_a,lines:below')
  })
})

describe('the Budget heading and the fold lines (spec §5.2 F)', () => {
  it('puts the three phrases in the Budget heading description, after "rules vN" (rounds-5)', () => {
    expect(HOW_SUMMARY).toBe(
      'counts when offered · each pool keeps its own Remaining · only the total is a cap'
    )
    expect(budgetDescription(3)).toBe(`rules v3 · ${HOW_SUMMARY}`)
    expect(budgetDescription(null)).toBe(HOW_SUMMARY)
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

  it('says demand in whole dollars, as every other figure on the page (rounds-17)', () => {
    const real = {
      ...BUDGET.total,
      demand: { ...BUDGET.total.demand, round2_asked: 9704.4, round1_unmet: 3566095.61 },
    }
    expect(demandSummary(real)).toBe(
      'Round 2 asks so far $9,704 (33 req) · Round 1 unmet ask $3,566,096 (47 req)'
    )
  })

  it('lists each counting type by its own money, then no named type', () => {
    expect(typesSummary(BUDGET.total)).toBe(
      'Standard award $14,400 · Appeal $4,200 · no named type $1,200'
    )
  })
})

describe('belowSummary scope (mutation guard)', () => {
  it('a one-pool summary leaves the no-request outside grants out', () => {
    expect(belowSummary(BUDGET, 'pool_b')).toBe('outside grants $3,100 · 1 held req')
  })
})
