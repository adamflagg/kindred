/**
 * Tests for comparison utility functions.
 *
 * TDD: Tests written first to define merging and delta calculation behavior.
 */
import { describe, it, expect } from 'vitest'
import { mergeDataForComparison, calculateDelta } from './comparisonUtils'

describe('mergeDataForComparison', () => {
  it('merges two datasets by name key', () => {
    const primary = [
      { name: 'Grade 5', value: 10 },
      { name: 'Grade 6', value: 20 },
    ]
    const compare = [
      { name: 'Grade 5', value: 8 },
      { name: 'Grade 6', value: 25 },
    ]

    const result = mergeDataForComparison(primary, compare)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      name: 'Grade 5',
      primaryValue: 10,
      compareValue: 8,
      change: 2,
      changePercent: 25,
    })
    expect(result[1]).toEqual({
      name: 'Grade 6',
      primaryValue: 20,
      compareValue: 25,
      change: -5,
      changePercent: -20,
    })
  })

  it('handles items only in primary (NEW)', () => {
    const primary = [
      { name: 'Grade 5', value: 10 },
      { name: 'Grade 7', value: 5 },
    ]
    const compare = [{ name: 'Grade 5', value: 8 }]

    const result = mergeDataForComparison(primary, compare)
    expect(result).toHaveLength(2)

    const grade7 = result.find((r) => r.name === 'Grade 7')
    expect(grade7).toEqual({
      name: 'Grade 7',
      primaryValue: 5,
      compareValue: 0,
      change: 5,
      changePercent: null,
    })
  })

  it('handles items only in comparison (GONE)', () => {
    const primary = [{ name: 'Grade 5', value: 10 }]
    const compare = [
      { name: 'Grade 5', value: 8 },
      { name: 'Grade 8', value: 3 },
    ]

    const result = mergeDataForComparison(primary, compare)
    expect(result).toHaveLength(2)

    const grade8 = result.find((r) => r.name === 'Grade 8')
    expect(grade8).toEqual({
      name: 'Grade 8',
      primaryValue: 0,
      compareValue: 3,
      change: -3,
      changePercent: -100,
    })
  })

  it('returns empty array when both datasets are empty', () => {
    const result = mergeDataForComparison([], [])
    expect(result).toEqual([])
  })

  it('handles custom nameKey', () => {
    const primary = [{ city: 'Oakland', value: 10 }]
    const compare = [{ city: 'Oakland', value: 8 }]

    const result = mergeDataForComparison(primary, compare, 'city')
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('Oakland')
    expect(result[0]?.primaryValue).toBe(10)
    expect(result[0]?.compareValue).toBe(8)
  })

  it('calculates changePercent as null when compare value is 0', () => {
    const primary = [{ name: 'New Item', value: 10 }]
    const compare: { name: string; value: number }[] = []

    const result = mergeDataForComparison(primary, compare)
    // Item only in primary → compareValue=0 → changePercent=null
    expect(result[0]?.changePercent).toBeNull()
  })

  it('calculates changePercent correctly for zero primary value', () => {
    const primary: { name: string; value: number }[] = []
    const compare = [{ name: 'Gone Item', value: 10 }]

    const result = mergeDataForComparison(primary, compare)
    // primaryValue=0, compareValue=10 → change=-10 → percent=-100
    expect(result[0]?.changePercent).toBe(-100)
  })

  it('merges by matchKey when names differ between years', () => {
    // Session names include the year, so names differ but cm_id is the same
    const primary = [
      { name: '2026 Taste of Camp 1', value: 50, id: '1000001' },
      { name: '2026 Session 2', value: 80, id: '1000002' },
    ]
    const compare = [
      { name: '2025 Taste of Camp', value: 45, id: '1000001' },
      { name: '2025 Session 2', value: 75, id: '1000002' },
    ]

    const result = mergeDataForComparison(primary, compare, 'name', 'id')
    expect(result).toHaveLength(2)
    // Should use primary year's display name
    expect(result[0]).toEqual({
      name: '2026 Taste of Camp 1',
      primaryValue: 50,
      compareValue: 45,
      change: 5,
      changePercent: 11.1,
    })
    expect(result[1]).toEqual({
      name: '2026 Session 2',
      primaryValue: 80,
      compareValue: 75,
      change: 5,
      changePercent: 6.7,
    })
  })

  it('matchKey handles items only in one dataset', () => {
    const primary = [{ name: '2026 New Session', value: 30, id: '1000003' }]
    const compare = [{ name: '2025 Old Session', value: 20, id: '1000004' }]

    const result = mergeDataForComparison(primary, compare, 'name', 'id')
    expect(result).toHaveLength(2)

    const newItem = result.find((r) => r.name === '2026 New Session')
    expect(newItem?.primaryValue).toBe(30)
    expect(newItem?.compareValue).toBe(0)

    const goneItem = result.find((r) => r.name === '2025 Old Session')
    expect(goneItem?.primaryValue).toBe(0)
    expect(goneItem?.compareValue).toBe(20)
  })

  it('sets compareName when matchKey merges items with different names', () => {
    const primary = [{ name: 'Taste of Camp 1', value: 50, id: '1000001' }]
    const compare = [{ name: 'Taste of Camp', value: 45, id: '1000001' }]

    const result = mergeDataForComparison(primary, compare, 'name', 'id')
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('Taste of Camp 1')
    expect(result[0]?.compareName).toBe('Taste of Camp')
  })

  it('does NOT set compareName when names are identical', () => {
    const primary = [{ name: 'Session 2', value: 80, id: '1000002' }]
    const compare = [{ name: 'Session 2', value: 75, id: '1000002' }]

    const result = mergeDataForComparison(primary, compare, 'name', 'id')
    expect(result).toHaveLength(1)
    expect(result[0]?.compareName).toBeUndefined()
  })

  it('does NOT set compareName for items only in primary', () => {
    const primary = [{ name: 'New Session', value: 30, id: '1000003' }]
    const compare: { name: string; value: number; id: string }[] = []

    const result = mergeDataForComparison(primary, compare, 'name', 'id')
    expect(result[0]?.compareName).toBeUndefined()
  })

  it('does NOT set compareName for items only in compare', () => {
    const primary: { name: string; value: number; id: string }[] = []
    const compare = [{ name: 'Old Session', value: 20, id: '1000004' }]

    const result = mergeDataForComparison(primary, compare, 'name', 'id')
    expect(result[0]?.compareName).toBeUndefined()
  })

  it('does NOT set compareName when no matchKey (name-based merge)', () => {
    const primary = [{ name: 'Grade 5', value: 10 }]
    const compare = [{ name: 'Grade 5', value: 8 }]

    const result = mergeDataForComparison(primary, compare)
    expect(result[0]?.compareName).toBeUndefined()
  })

  it('matchKey defaults to nameKey when not provided', () => {
    const primary = [{ name: 'Grade 5', value: 10 }]
    const compare = [{ name: 'Grade 5', value: 8 }]

    // No matchKey → should behave identically to original
    const result = mergeDataForComparison(primary, compare, 'name')
    expect(result).toHaveLength(1)
    expect(result[0]?.primaryValue).toBe(10)
    expect(result[0]?.compareValue).toBe(8)
  })
})

describe('calculateDelta', () => {
  it('calculates positive delta', () => {
    const result = calculateDelta(120, 100)
    expect(result).toEqual({
      change: 20,
      changePercent: 20,
      direction: 'up',
    })
  })

  it('calculates negative delta', () => {
    const result = calculateDelta(80, 100)
    expect(result).toEqual({
      change: -20,
      changePercent: -20,
      direction: 'down',
    })
  })

  it('handles zero change', () => {
    const result = calculateDelta(100, 100)
    expect(result).toEqual({
      change: 0,
      changePercent: 0,
      direction: 'neutral',
    })
  })

  it('handles zero compare value', () => {
    const result = calculateDelta(50, 0)
    expect(result).toEqual({
      change: 50,
      changePercent: null,
      direction: 'up',
    })
  })

  it('handles both zero', () => {
    const result = calculateDelta(0, 0)
    expect(result).toEqual({
      change: 0,
      changePercent: 0,
      direction: 'neutral',
    })
  })

  it('rounds percentages to one decimal place', () => {
    const result = calculateDelta(103, 100)
    expect(result.changePercent).toBe(3)
    // (103-100)/100 = 3% exactly

    const result2 = calculateDelta(101, 300)
    // (101-300)/300 = -66.333...
    expect(result2.changePercent).toBe(-66.3)
  })
})
