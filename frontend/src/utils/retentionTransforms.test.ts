/**
 * TDD Tests for computeRetentionOutliers utility function.
 *
 * Tests written FIRST before implementation (TDD).
 * Outliers are geographic categories whose retention rate deviates notably
 * from the overall average.
 */
import { describe, it, expect } from 'vitest'
import { computeRetentionOutliers, regionToBarData, genderToPieData } from './retentionTransforms'
import type { RetentionRateBarItem, RetentionByGender } from '../types/metrics'

const makeItem = (
  name: string,
  retentionRate: number,
  baseCount: number
): RetentionRateBarItem => ({
  name,
  retentionRate,
  baseCount,
  returnedCount: Math.round(retentionRate * baseCount),
})

describe('computeRetentionOutliers', () => {
  it('should return outliers above minDeviation threshold', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Riverside', 0.85, 20), // +20pp above 0.65
      makeItem('Oak Valley', 0.65, 30), // exactly average
      makeItem('Hillcrest', 0.35, 20), // -30pp below 0.65
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    expect(outliers.length).toBe(2)
    expect(outliers[0]!.name).toBe('Hillcrest') // 30pp deviation > 20pp
    expect(outliers[1]!.name).toBe('Riverside') // 20pp deviation
  })

  it('should filter out categories below minBaseCount', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Riverside', 0.95, 4), // high rate but only 4 campers (below default 8)
      makeItem('Oak Valley', 0.9, 20), // +25pp, 20 campers
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    expect(outliers.length).toBe(1)
    expect(outliers[0]!.name).toBe('Oak Valley')
  })

  it('should sort by impact descending (deviation * volume)', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Riverside', 0.8, 20), // +15pp, impact = 15*20/100 = 3.0
      makeItem('Hillcrest', 0.3, 15), // -35pp, impact = 35*15/100 = 5.25
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    expect(outliers.map((o) => o.name)).toEqual(['Hillcrest', 'Riverside'])
  })

  it('should return empty array when no outliers qualify', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Riverside', 0.68, 20), // +3pp (below 10pp threshold)
      makeItem('Oak Valley', 0.62, 15), // -3pp
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    expect(outliers).toEqual([])
  })

  it('should handle empty input data', () => {
    const outliers = computeRetentionOutliers([], 0.65)
    expect(outliers).toEqual([])
  })

  it('should respect custom minBaseCount option', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Riverside', 0.9, 15), // 15 campers, +25pp, impact = 25*15/100 = 3.75
      makeItem('Oak Valley', 0.9, 20), // 20 campers, +25pp, impact = 25*20/100 = 5.0
    ]
    const overallRate = 0.65

    // Both pass impact gate; without custom minBaseCount both pass (>= 8)
    const outliers = computeRetentionOutliers(data, overallRate)
    expect(outliers.length).toBe(2)

    // With higher minBaseCount, Riverside (15) still passes but test different threshold
    const filtered = computeRetentionOutliers(data, overallRate, { minBaseCount: 18 })
    expect(filtered.length).toBe(1)
    expect(filtered[0]!.name).toBe('Oak Valley')
  })

  it('should respect custom minDeviation option', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Riverside', 0.8, 20), // +15pp, impact = 15*20/100 = 3.0
      makeItem('Oak Valley', 0.72, 50), // +7pp, impact = 7*50/100 = 3.5
    ]
    const overallRate = 0.65

    // Oak Valley has 7pp deviation (below default 10pp threshold) but passes with minDeviation: 5
    const outliers = computeRetentionOutliers(data, overallRate, { minDeviation: 5 })

    expect(outliers.length).toBe(2)
  })

  it('should calculate deviation as percentage points', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Riverside', 0.85, 20), // 85% - 65% = +20pp
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    expect(outliers[0]!.deviation).toBe(20)
    expect(outliers[0]!.retentionRate).toBe(0.85)
    expect(outliers[0]!.baseCount).toBe(20)
    expect(outliers[0]!.returnedCount).toBe(17) // Math.round(0.85 * 20)
  })

  it('should produce negative deviation for below-average outliers', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Hillcrest', 0.4, 15), // 40% - 65% = -25pp
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    expect(outliers[0]!.deviation).toBe(-25)
  })

  // Impact-weighted scoring tests
  it('should include impact score on outliers', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Springfield', 0.51, 238), // -14pp, impact = 14 * 238 / 100 = 33.32
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    expect(outliers[0]!.impact).toBeCloseTo((14 * 238) / 100, 0)
  })

  it('should include expectedCount on outliers', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Springfield', 0.51, 238), // expected = 0.65 * 238 = 155
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    expect(outliers[0]!.expectedCount).toBe(Math.round(0.65 * 238))
  })

  it('should sort by impact descending, not raw deviation', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Moraga', 0.22, 9), // -43pp, impact = 43 * 9 / 100 = 3.87
      makeItem('Springfield', 0.51, 238), // -14pp, impact = 14 * 238 / 100 = 33.32
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    // Springfield should rank first due to higher impact despite lower deviation
    expect(outliers[0]!.name).toBe('Springfield')
    expect(outliers[1]!.name).toBe('Moraga')
  })

  it('should filter out outliers below impact threshold of 3.0', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Tiny Town', 0.25, 8), // -40pp but impact = 40 * 8 / 100 = 3.2 (barely above)
      makeItem('Micro City', 0.53, 8), // -12pp, impact = 12 * 8 / 100 = 0.96 (below 3.0)
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    // Micro City filtered out (impact < 3.0), Tiny Town barely passes
    expect(outliers.length).toBe(1)
    expect(outliers[0]!.name).toBe('Tiny Town')
  })

  it('should always include zero-retention groups with sufficient base count', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Ghost Town', 0.0, 8), // 0% retention, impact = 65 * 8 / 100 = 5.2
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    // Zero retention with baseCount >= 8 should always be included
    expect(outliers.length).toBe(1)
    expect(outliers[0]!.name).toBe('Ghost Town')
  })
})

describe('regionToBarData', () => {
  it('should convert region retention data to bar chart items', () => {
    const data = [
      { region: 'eastBay', base_count: 50, returned_count: 40, retention_rate: 0.8 },
      { region: 'sf', base_count: 30, returned_count: 20, retention_rate: 0.667 },
    ]

    const result = regionToBarData(data)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      name: 'eastBay',
      retentionRate: 0.8,
      baseCount: 50,
      returnedCount: 40,
    })
    expect(result[1]).toEqual({
      name: 'sf',
      retentionRate: 0.667,
      baseCount: 30,
      returnedCount: 20,
    })
  })

  it('should return empty array for undefined input', () => {
    expect(regionToBarData(undefined)).toEqual([])
  })

  it('should return empty array for empty input', () => {
    expect(regionToBarData([])).toEqual([])
  })
})

describe('genderToPieData', () => {
  it('should convert retention gender data to pie chart format', () => {
    const data: RetentionByGender[] = [
      { gender: 'M', base_count: 50, returned_count: 40, retention_rate: 0.8 },
      { gender: 'F', base_count: 30, returned_count: 20, retention_rate: 0.667 },
    ]

    const result = genderToPieData(data)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      name: 'Male',
      value: 40,
      percentage: expect.closeTo(66.7, 0),
      id: 'M',
    })
    expect(result[1]).toEqual({
      name: 'Female',
      value: 20,
      percentage: expect.closeTo(33.3, 0),
      id: 'F',
    })
  })

  it('should return empty array for undefined input', () => {
    expect(genderToPieData(undefined)).toEqual([])
  })

  it('should return empty array for empty input', () => {
    expect(genderToPieData([])).toEqual([])
  })

  it('should handle single gender', () => {
    const data: RetentionByGender[] = [
      { gender: 'M', base_count: 10, returned_count: 8, retention_rate: 0.8 },
    ]

    const result = genderToPieData(data)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      name: 'Male',
      value: 8,
      percentage: 100,
      id: 'M',
    })
  })
})
