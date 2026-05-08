import { describe, it, expect } from 'vitest'
import { trendDirection } from './trendDirection'

describe('trendDirection', () => {
  it('positive → up', () => {
    expect(trendDirection(1)).toBe('up')
    expect(trendDirection(0.001)).toBe('up')
    expect(trendDirection(1000)).toBe('up')
  })

  it('negative → down', () => {
    expect(trendDirection(-1)).toBe('down')
    expect(trendDirection(-0.001)).toBe('down')
  })

  it('zero → neutral', () => {
    expect(trendDirection(0)).toBe('neutral')
  })

  it('coerces string-numerics', () => {
    expect(trendDirection('5')).toBe('up')
    expect(trendDirection('-2')).toBe('down')
    expect(trendDirection('0')).toBe('neutral')
  })
})
