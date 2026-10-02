import { describe, expect, it } from 'vitest'

import { RULES_DOCUMENT } from '../rules/rulesFixtures'
import { OPTIONS, results } from './scenarioFixtures'
import {
  BAND_RANGE,
  NO_PENDING,
  SHIFT_RANGE,
  bandWords,
  changedLevers,
  fitWords,
  hasPending,
  isDollarForDollar,
  keptGroups,
  unmoved,
  readStep,
  resultLines,
  shiftWords,
  sizingDocument,
  startingPointOf,
  stepNote,
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
    expect(readStep('+2', SHIFT_RANGE)).toBe(2)
    expect(readStep('+11', SHIFT_RANGE)).toBeNull()
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

  it('words the switch from its state, a rise without a plus, and an unstated switch as nothing', () => {
    const effect = (on: boolean | null, change: number) => ({
      lever: 'dollar_for_dollar',
      label: 'x',
      step: null,
      on,
      round1_change: change,
    })
    expect(stepWords(effect(false, 8000))).toBe('Turning it on moves Round 1 by $8,000')
    expect(stepWords(effect(null, 8000))).toBeNull()
  })
})

describe('a typed step the slider cannot take (residue 12)', () => {
  it('says what the box takes, briefly, for an off-step or out-of-range value', () => {
    expect(stepNote('1200', BAND_RANGE, 'money')).toBe('in steps of $500')
    expect(stepNote('20000', BAND_RANGE, 'money')).toBe('from −$10,000 to $10,000')
    expect(stepNote('-2.25', SHIFT_RANGE, 'points')).toBe('in steps of 0.5 pts')
    expect(stepNote('11', SHIFT_RANGE, 'points')).toBe('from −15 to +10 pts')
    expect(stepNote('abc', SHIFT_RANGE, 'points')).toBe('not a number')
  })

  it('says nothing for a step it takes, or while the box is still being typed into', () => {
    expect(stepNote('1500', BAND_RANGE, 'money')).toBeNull()
    expect(stepNote('−2.5', SHIFT_RANGE, 'points')).toBeNull()
    expect(stepNote('', SHIFT_RANGE, 'points')).toBeNull()
    expect(stepNote('-', SHIFT_RANGE, 'points')).toBeNull()
    // On the way to "2.5" (rereview m2): still typing, so no "not a number" flash.
    expect(stepNote('2.', SHIFT_RANGE, 'points')).toBeNull()
    expect(stepNote('-2.', SHIFT_RANGE, 'points')).toBeNull()
  })
})

describe("a setting moved back to the draft's own value is not moved (scan #1)", () => {
  const stored = { ...RULES_DOCUMENT, awards: { ...RULES_DOCUMENT.awards, minimum: '250.00' } }

  it('drops a minimum equal by value and a switch equal to the draft, and keeps the rest', () => {
    expect(unmoved({ ...NO_PENDING, minimum: '250', dollar: true }, stored)).toEqual(NO_PENDING)
    expect(unmoved({ ...NO_PENDING, minimum: '250.5', dollar: false }, stored)).toEqual({
      ...NO_PENDING,
      minimum: '250.5',
      dollar: false,
    })
    expect(unmoved({ ...NO_PENDING, tierShift: -1 }, stored)).toEqual({
      ...NO_PENDING,
      tierShift: -1,
    })
  })

  it('so its name is not amber', () => {
    expect(changedLevers([], unmoved({ ...NO_PENDING, minimum: '250' }, stored)).size).toBe(0)
  })
})

describe('which settings differ from where the draft came from (residue 7)', () => {
  const change = (...path: string[]) => ({ path, kind: 'changed' as const, before: 1, after: 2 })

  it("reads the draft's recorded changes by the part of the document each setting moves", () => {
    expect(
      changedLevers(
        [
          change('award_tables', 'general', 'tiers', '1', 'r1_pct'),
          change('tiers', 'bands'),
          change('awards', 'minimum'),
          change('grants', 'offset_mode'),
        ],
        NO_PENDING
      )
    ).toEqual(new Set(['tier_shift', 'band_width', 'minimum', 'dollar_for_dollar']))
    expect(changedLevers([change('milestones', 'application_deadline')], NO_PENDING)).toEqual(
      new Set()
    )
  })

  it('counts what is moving and not yet recorded too', () => {
    expect(changedLevers([], { ...NO_PENDING, bandDelta: 500, dollar: false })).toEqual(
      new Set(['band_width', 'dollar_for_dollar'])
    )
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

  it('leaves an orphan variant out of the list rather than inventing a group', () => {
    const orphan = { ...OPTIONS[1]!, code: 'C1', starting_point: 'C' }
    expect(keptGroups([...OPTIONS, orphan]).map((g) => g.start.code)).toEqual(['A', 'B'])
    expect(keptGroups([...OPTIONS, orphan]).flatMap((g) => g.variants.map((v) => v.code))).toEqual([
      'A1',
    ])
  })
})

describe('the results (results.py)', () => {
  it('lists every figure in order, each under its meaning', () => {
    expect(resultLines(results(735000)).map((l) => [l.key, l.label, l.value])).toEqual([
      ['round1', 'Round 1', '$735,000'],
      ['round2', 'Round 2, appeals keyed so far', '$20,500'],
      ['round3', 'Round 3', '$950'],
      ['round1_remaining', 'Round 1 remaining', '$65,000'],
      ['remaining', 'Remaining, every round', '$243,550'],
      ['at_minimum', 'At the minimum', '12 requests'],
      ['held', 'Held', '9 requests'],
      ['round1_unmet', 'Round 1 unmet ask (below the line)', '$50,920'],
    ])
  })

  it('never inks a figure that rounds to $0 as negative (scan #5)', () => {
    const line = resultLines(results(735000, { remaining: -0.004 })).find(
      (l) => l.key === 'remaining'
    )
    expect(line?.value).toBe('$0')
    expect(line?.negative).toBe(false)
  })

  it('marks an overspent Remaining negative', () => {
    expect(
      resultLines(results(735000, { remaining: -1200 })).find((l) => l.key === 'remaining')
    ).toEqual({
      key: 'remaining',
      label: 'Remaining, every round',
      value: '−$1,200',
      negative: true,
    })
  })

  it('shows nothing where the server has nothing, and never calls it negative', () => {
    const lines = resultLines(results(735000, { remaining: null, round1_remaining: null }))
    for (const key of ['remaining', 'round1_remaining']) {
      expect(lines.find((l) => l.key === key)).toMatchObject({ value: '—', negative: false })
    }
  })

  it('says "1 request" in the singular', () => {
    const lines = resultLines(results(735000, { at_minimum: 1, held: 0 }))
    expect(lines.find((l) => l.key === 'at_minimum')?.value).toBe('1 request')
    expect(lines.find((l) => l.key === 'held')?.value).toBe('0 requests')
  })
})

describe('Fit to budget in words (fit.py; D119)', () => {
  const fit = (outcome: 'fits' | 'over_at_lowest' | 'under_at_highest', shift: number) => ({
    tier_shift: shift,
    outcome,
    tightest_pool: 'pool_a',
    tried: 11,
    document: RULES_DOCUMENT,
    results: results(800000),
    report: { issues: [] },
  })

  it("says the shift that uses Round 1's allocation, and the tightest pool as information", () => {
    expect(fitWords(fit('fits', -4.5))).toEqual({
      headline:
        "Shifting every tier −4.5 pts uses Round 1's allocation: Round 1 $800,000, $0 left.",
      pool: 'Tightest pool: Pool A, Round 1 remaining −$30,000. Pools are guidance; only the total budget is hard.',
    })
  })

  it("says so when even the range's ends don't fit", () => {
    expect(fitWords(fit('over_at_lowest', -100)).headline).toBe(
      'Even the lowest shift (−100 pts) leaves Round 1 over its allocation.'
    )
    expect(fitWords(fit('under_at_highest', 100)).headline).toBe(
      "Even the highest shift (+100 pts) leaves part of Round 1's allocation unused."
    )
  })

  it('names no pool whose Round 1 has no allocation (null remaining)', () => {
    const base = fit('fits', 0)
    const pools = base.results.pools.map((p) => ({ ...p, round1_remaining: null }))
    expect(fitWords({ ...base, results: { ...base.results, pools } }).pool).toBeNull()
  })

  it('names no pool when none is tightest, and never calls the figure the pools summed', () => {
    const none = fitWords({ ...fit('fits', 0), tightest_pool: null })
    expect(none.pool).toBeNull()
    expect(none.headline).not.toMatch(/pools/i)
  })
})
