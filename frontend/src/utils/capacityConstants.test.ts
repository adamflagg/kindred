import { describe, expect, it } from 'vitest'
import { DEFAULT_BUNK_CAPACITY, MAX_BUNK_CAPACITY } from './capacityConstants'

describe('capacity constants', () => {
  it('DEFAULT_BUNK_CAPACITY is 12', () => {
    expect(DEFAULT_BUNK_CAPACITY).toBe(12)
  })

  it('MAX_BUNK_CAPACITY is 14', () => {
    expect(MAX_BUNK_CAPACITY).toBe(14)
  })

  it('MAX is strictly greater than DEFAULT', () => {
    expect(MAX_BUNK_CAPACITY).toBeGreaterThan(DEFAULT_BUNK_CAPACITY)
  })
})
