import { describe, expect, it } from 'vitest'

import { RULES_DOCUMENT } from '../rules/rulesFixtures'
import { OPTIONS, results } from './scenarioFixtures'
import {
  BAND_RANGE,
  NO_PENDING,
  SHIFT_RANGE,
  bandWords,
  hasPending,
  isDollarForDollar,
  keptGroups,
  readStep,
  resultLines,
  shiftWords,
  sizingDocument,
  startingPointOf,
  stepWords,
} from './scenarioModel'

describe("the draft's settings (§7.4; D37, D137)", () => {
  it('knows when a slider has moved', () => {
    expect(hasPending(NO_PENDING)).toBe(false)
    expect(hasPending({ ...NO_PENDING, tierShift: -1 })).toBe(true)
    expect(hasPending({ ...NO_PENDING, dollar: true })).toBe(true)
  })

  it('applies the minimum and the offset mode, and touches nothing else', () => {
    const moved = sizingDocument(RULES_DOCUMENT, { ...NO_PENDING, minimum: '150', dollar: false })
    expect(moved.awards.minimum).toBe('150')
    expect(moved.grants.offset_mode).toBe('reduce_cost_basis')
    expect(moved.tiers).toBe(RULES_DOCUMENT.tiers)
    expect(sizingDocument(RULES_DOCUMENT, NO_PENDING)).toEqual(RULES_DOCUMENT)
    expect(isDollarForDollar(RULES_DOCUMENT)).toBe(true)
  })

  it("reads a typed step only within the slider's range and step", () => {
    expect(readStep('-5', SHIFT_RANGE)).toBe(-5)
    expect(readStep('−2.5', SHIFT_RANGE)).toBe(-2.5)
    expect(readStep('-2.25', SHIFT_RANGE)).toBeNull()
    expect(readStep('11', SHIFT_RANGE)).toBeNull()
    expect(readStep('5000', BAND_RANGE)).toBe(5000)
    expect(readStep('5050', BAND_RANGE)).toBeNull()
  })

  it('says each move in words', () => {
    expect(shiftWords(-5)).toBe('−5 pts')
    expect(shiftWords(2.5)).toBe('+2.5 pts')
    expect(bandWords(5000)).toBe('$5,000 wider')
    expect(bandWords(-500)).toBe('$500 narrower')
    expect(bandWords(0)).toBe('as they are')
  })

  it("says what one step moves Round 1 by, in the server's own figures", () => {
    const effect = (lever: string, step: number | null, on: boolean | null) => ({
      lever,
      label: lever,
      step,
      on,
      round1_change: -12400,
    })
    expect(stepWords(effect('tier_shift', 1, null))).toBe('Each +1 pt moves Round 1 by −$12,400')
    expect(stepWords(effect('minimum', 10, null))).toBe('Each +$10 moves Round 1 by −$12,400')
    expect(stepWords(effect('band_width', 1000, null))).toBe(
      'Each $1,000 wider moves Round 1 by −$12,400'
    )
    expect(stepWords(effect('dollar_for_dollar', null, true))).toBe(
      'Turning it off moves Round 1 by −$12,400'
    )
    expect(stepWords(undefined)).toBeNull()
  })
})

describe('kept options in two levels (D38)', () => {
  it('lists starting points with their variants under them', () => {
    expect(keptGroups(OPTIONS).map((g) => [g.start.code, g.variants.map((v) => v.code)])).toEqual([
      ['A', ['A1']],
      ['B', []],
    ])
    expect(startingPointOf(OPTIONS, 'A1')).toBe('A')
    expect(startingPointOf(OPTIONS, 'B')).toBe('B')
  })
})

describe('the results (results.py)', () => {
  it('names each figure by its meaning, Round 2 as the appeals keyed so far', () => {
    const lines = resultLines(results(735000, { remaining: -1200 }))
    expect(lines.map((l) => l.label)).toContain('Round 2, appeals keyed so far')
    expect(lines.find((l) => l.key === 'remaining')).toEqual({
      key: 'remaining',
      label: 'Remaining, every round',
      value: '−$1,200',
      negative: true,
    })
  })
})
