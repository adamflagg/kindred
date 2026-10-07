import { describe, expect, it } from 'vitest'

import { gridRow, roundOut } from './gridFixtures'
import {
  fundLines,
  listOutside,
  outsideOfPosted,
  outsideOfRound,
  outsideOfTotal,
  outsideTagWords,
} from './outside'

const whole = gridRow({
  total_decided: 3675,
  total_posted: 3675,
  rounds: [
    roundOut(1, 'posted', {
      decided: 3675,
      posted: 3675,
      outside_budget: 3675,
      outside_label: 'Full-cost program',
    }),
  ],
})
const split = gridRow({
  total_decided: 4800,
  total_posted: 4800,
  rounds: [
    roundOut(1, 'posted', {
      decided: 4800,
      posted: 4800,
      outside_budget: 1224,
      outside_label: 'Partner fund',
    }),
  ],
})
const clawed = gridRow({
  total_decided: 3675,
  total_posted: null,
  rounds: [
    roundOut(1, 'posted', { decided: 3675, posted: 3675, outside_budget: null, clawed_back: true }),
  ],
})

describe('outside money of a row', () => {
  it('tags a wholly outside cell "outside" and a split one with its amount', () => {
    expect(outsideTagWords(outsideOfRound(whole, 1)!)).toBe('outside')
    expect(outsideTagWords(outsideOfRound(split, 1)!)).toBe('$1,224 outside')
    expect(outsideOfTotal(split)).toEqual({ amount: 1224, whole: false })
    expect(outsideOfPosted(whole)).toEqual({ amount: 3675, whole: true })
  })

  it('leaves a clawed-back round out (Review Focus 5)', () => {
    expect([outsideOfRound(clawed, 1), outsideOfTotal(clawed), outsideOfPosted(clawed)]).toEqual([
      null,
      null,
      null,
    ])
    expect(listOutside([whole, split, clawed])).toBe(4899)
  })

  it('leaves a clawed-back round out even if it still carries an amount', () => {
    const stale = gridRow({
      rounds: [roundOut(1, 'posted', { decided: 900, outside_budget: 900, clawed_back: true })],
    })
    expect(outsideOfRound(stale, 1)).toBeNull()
    expect(outsideOfTotal(stale)).toBeNull()
  })

  it('reads a row with no outside money (fields absent or null) as none', () => {
    const plain = gridRow()
    expect(outsideOfRound(plain, 1)).toBeNull()
    expect(outsideOfTotal(plain)).toBeNull()
    expect(outsideOfPosted(plain)).toBeNull()
    expect(fundLines(plain)).toEqual([])
    expect(listOutside([plain])).toBe(0)
  })

  it('sums rounds for Total, and only posted rounds for Posted', () => {
    const two = gridRow({
      total_decided: 2000,
      total_posted: 1000,
      rounds: [
        roundOut(1, 'posted', { decided: 1000, posted: 1000, outside_budget: 400 }),
        roundOut(2, 'needs_offer', { decided: 1000, outside_budget: 1000 }),
      ],
    })
    expect(outsideOfTotal(two)).toEqual({ amount: 1400, whole: false })
    expect(outsideOfPosted(two)).toEqual({ amount: 400, whole: false })
  })

  it('names the fund and the split for the opened row', () => {
    expect(fundLines(whole)).toEqual(['Round 1 · Full-cost program $3,675 outside'])
    expect(fundLines(split)).toEqual(['Round 1 · camp award $3,576 · Partner fund $1,224 outside'])
  })
})
