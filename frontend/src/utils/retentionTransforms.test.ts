/**
 * TDD Tests for computeRetentionOutliers utility function.
 *
 * Tests written FIRST before implementation (TDD).
 * Outliers are geographic categories whose retention rate deviates notably
 * from the overall average.
 */
import { describe, it, expect } from 'vitest'
import { computeRetentionOutliers } from './retentionTransforms'
import type { RetentionRateBarItem } from '../components/metrics/RetentionRateBarChart'

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
      makeItem('Oak Valley', 0.90, 20), // +25pp, 20 campers
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    expect(outliers.length).toBe(1)
    expect(outliers[0]!.name).toBe('Oak Valley')
  })

  it('should sort by absolute deviation descending', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Riverside', 0.80, 20), // +15pp
      makeItem('Hillcrest', 0.30, 15), // -35pp
      makeItem('Maple Grove', 0.90, 10), // +25pp
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    expect(outliers.map((o) => o.name)).toEqual(['Hillcrest', 'Maple Grove', 'Riverside'])
    expect(outliers.map((o) => Math.abs(o.deviation))).toEqual([35, 25, 15])
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
      makeItem('Riverside', 0.90, 5), // 5 campers, default filter removes it
      makeItem('Oak Valley', 0.90, 10),
    ]
    const overallRate = 0.65

    // With lower threshold, Riverside should now be included
    const outliers = computeRetentionOutliers(data, overallRate, { minBaseCount: 3 })

    expect(outliers.length).toBe(2)
    expect(outliers.map((o) => o.name)).toContain('Riverside')
  })

  it('should respect custom minDeviation option', () => {
    const data: RetentionRateBarItem[] = [
      makeItem('Riverside', 0.80, 20), // +15pp
      makeItem('Oak Valley', 0.72, 15), // +7pp
    ]
    const overallRate = 0.65

    // With lower deviation threshold, Oak Valley should now qualify
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
      makeItem('Hillcrest', 0.40, 15), // 40% - 65% = -25pp
    ]
    const overallRate = 0.65

    const outliers = computeRetentionOutliers(data, overallRate)

    expect(outliers[0]!.deviation).toBe(-25)
  })
})
