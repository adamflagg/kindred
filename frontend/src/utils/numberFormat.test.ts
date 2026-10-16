import { describe, expect, it } from 'vitest'
import {
  MINUS,
  formatCount,
  formatPercent,
  formatRate,
  formatSignedCount,
  formatSignedPercent,
  formatValue,
} from './numberFormat'

describe('numberFormat (decision 43, #3207)', () => {
  it('uses the true minus sign, U+2212', () => {
    expect(MINUS).toBe('−')
  })

  describe('formatCount', () => {
    it('adds thousands separators', () => {
      expect(formatCount(1293)).toBe('1,293')
      expect(formatCount(12)).toBe('12')
      expect(formatCount(2084000)).toBe('2,084,000')
    })
    it('keeps a real zero and shows a missing value as an em dash', () => {
      expect(formatCount(0)).toBe('0')
      expect(formatCount(null)).toBe('—')
      expect(formatCount(undefined)).toBe('—')
    })
    it('writes a negative with the true minus, never a hyphen', () => {
      expect(formatCount(-1200)).toBe(`${MINUS}1,200`)
    })
  })

  describe('formatPercent: one convention, one decimal', () => {
    it('formats a 0-100 percentage to one decimal', () => {
      expect(formatPercent(42.456)).toBe('42.5%')
      expect(formatPercent(100)).toBe('100.0%')
      expect(formatPercent(0)).toBe('0.0%')
    })
    it('shows a missing value as an em dash', () => {
      expect(formatPercent(null)).toBe('—')
      expect(formatPercent(undefined)).toBe('—')
    })
    it('never prints a negative zero', () => {
      expect(formatPercent(-0.01)).toBe('0.0%')
    })
    it('uses the true minus for a negative percentage', () => {
      expect(formatPercent(-3.25)).toBe(`${MINUS}3.3%`)
    })
  })

  describe('formatRate: a 0-1 fraction as the same percent', () => {
    it('reads the fraction as a percentage with one decimal', () => {
      expect(formatRate(0.6789)).toBe('67.9%')
      expect(formatRate(1)).toBe('100.0%')
      expect(formatRate(null)).toBe('—')
    })
  })

  describe('signed changes', () => {
    it('formatSignedCount writes +, the true minus, and separators', () => {
      expect(formatSignedCount(1234)).toBe('+1,234')
      expect(formatSignedCount(-56)).toBe(`${MINUS}56`)
      expect(formatSignedCount(-1500)).toBe(`${MINUS}1,500`)
      expect(formatSignedCount(0)).toBe('0')
    })
    it('formatSignedPercent keeps one decimal and the true minus', () => {
      expect(formatSignedPercent(5.04)).toBe('+5.0%')
      expect(formatSignedPercent(-7.26)).toBe(`${MINUS}7.3%`)
      expect(formatSignedPercent(0)).toBe('0.0%')
      expect(formatSignedPercent(-0.04)).toBe('0.0%')
    })
  })

  describe('formatValue: what a card shows', () => {
    it('formats a number as a count and passes a string through', () => {
      expect(formatValue(1134)).toBe('1,134')
      expect(formatValue('67.9%')).toBe('67.9%')
    })
  })
})
