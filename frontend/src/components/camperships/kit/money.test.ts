/**
 * Camperships money formatting (spec §4.2; D74, D20, D59; mockups/money-format.html A·A·D·A·A·B).
 * Figures are invented.
 */
import { describe, expect, it } from 'vitest'

import {
  MINUS,
  formatGap,
  formatMoney,
  formatMoneyCompact,
  isNegativeMoney,
  moneyCsv,
  toCents,
} from './money'

describe('formatMoney (D74)', () => {
  it.each([
    [null, '—'],
    [undefined, '—'],
    [0, '$0'],
    [-0.004, '$0'],
    [1800, '$1,800'],
    [2399.72, '$2,399.72'],
    [0.28, '$0.28'],
    [1234567, '$1,234,567'],
    [-1200, `${MINUS}$1,200`],
    [-0.28, `${MINUS}$0.28`],
  ])('%s reads %s', (value, expected) => {
    expect(formatMoney(value)).toBe(expected)
  })

  it('writes "—" for nothing there and "$0" for a real zero, so the two never look alike', () => {
    expect(formatMoney(null)).not.toBe(formatMoney(0))
  })

  it('never puts a plus sign on an increase', () => {
    expect(formatMoney(300)).not.toContain('+')
  })

  it('uses the true minus sign (U+2212), which lines up with the figures', () => {
    expect(MINUS).toBe('−')
  })
})

describe('formatMoneyCompact (the Remaining line, Decision 2)', () => {
  it.each([
    [null, '—'],
    [0, '$0'],
    [153400, '$153k'],
    // Ruling 2026-10-01 (plan review): thousands round toward zero, so the line never shows more
    // than is left: $1,500 reads "$1k", never "$2k".
    [153900, '$153k'],
    [1500, '$1k'],
    [18000, '$18k'],
    // Under $1,000: the exact figure, cents included where it has them (Decision 2).
    [840, '$840'],
    [999.6, '$999.60'],
    [0.4, '$0.40'],
    [-1200, `${MINUS}$1k`],
    [-1900, `${MINUS}$1k`],
    [-400, `${MINUS}$400`],
  ])('%s reads %s', (value, expected) => {
    expect(formatMoneyCompact(value)).toBe(expected)
  })
})

describe('isNegativeMoney', () => {
  it.each([
    [-1, true],
    [-0.004, false],
    [0, false],
    [5, false],
    [null, false],
    [undefined, false],
  ])('%s → %s', (value, expected) => {
    expect(isNegativeMoney(value)).toBe(expected)
  })
})

describe('formatGap (D59, D74: exact to the cent)', () => {
  it.each([
    [1800, 1590, 'short $210'],
    [1200, 1500, 'over $300'],
    [2400, 2399.72, 'short $0.28'],
    [1800, 1800, null],
    [1800, 1800.004, null],
  ])('locked %s, CampMinder %s → %s', (locked, inCampMinder, expected) => {
    expect(formatGap(locked, inCampMinder)).toBe(expected)
  })
})

describe('moneyCsv (§11: plain signed numbers)', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    [0, '0'],
    [1800, '1800'],
    [2399.72, '2399.72'],
    [-1200, '-1200'],
    [-0.28, '-0.28'],
  ])('%s → %s', (value, expected) => {
    expect(moneyCsv(value)).toBe(expected)
  })
})

describe('toCents', () => {
  it('rounds float noise to whole cents', () => {
    expect(toCents(0.1 + 0.2)).toBe(30)
  })
})
