/**
 * TDD Tests for region classification and aggregation utilities.
 *
 * Tests written FIRST before implementation (TDD).
 * Regions group cities into Bay Area sub-regions (Marin, SF, Peninsula, etc.),
 * Other CA, Rest of US, and International.
 */
import { describe, it, expect } from 'vitest'
import {
  classifyCity,
  aggregateCityCountsByRegion,
  aggregateCityRetentionByRegion,
  aggregateCityEnrollmentByRegion,
  REGION_DISPLAY_NAMES,
} from './regionUtils'
import type { CityBreakdown, RetentionByCity } from '../types/metrics'

describe('classifyCity', () => {
  it('should classify Oakland as eastBay', () => {
    expect(classifyCity('Oakland')).toBe('eastBay')
  })

  it('should classify San Francisco as sf', () => {
    expect(classifyCity('San Francisco')).toBe('sf')
  })

  it('should classify Los Angeles as Other CA', () => {
    expect(classifyCity('Los Angeles')).toBe('Other CA')
  })

  it('should classify Denver as Rest of US', () => {
    expect(classifyCity('Denver')).toBe('Rest of US')
  })

  it('should classify London as International', () => {
    expect(classifyCity('London')).toBe('International')
  })

  it('should classify empty string as International', () => {
    expect(classifyCity('')).toBe('International')
  })

  it('should classify Mill Valley as marin', () => {
    expect(classifyCity('Mill Valley')).toBe('marin')
  })

  it('should classify Palo Alto as peninsula', () => {
    expect(classifyCity('Palo Alto')).toBe('peninsula')
  })

  it('should classify San Jose as southBay', () => {
    expect(classifyCity('San Jose')).toBe('southBay')
  })

  it('should classify Napa as napaSonoma', () => {
    expect(classifyCity('Napa')).toBe('napaSonoma')
  })
})

describe('REGION_DISPLAY_NAMES', () => {
  it('should have display names for all Bay Area regions', () => {
    expect(REGION_DISPLAY_NAMES['marin']).toBe('Marin')
    expect(REGION_DISPLAY_NAMES['sf']).toBe('San Francisco')
    expect(REGION_DISPLAY_NAMES['peninsula']).toBe('Peninsula')
    expect(REGION_DISPLAY_NAMES['southBay']).toBe('South Bay')
    expect(REGION_DISPLAY_NAMES['eastBay']).toBe('East Bay')
    expect(REGION_DISPLAY_NAMES['napaSonoma']).toBe('Napa / Sonoma')
  })

  it('should have display names for non-Bay-Area categories', () => {
    expect(REGION_DISPLAY_NAMES['Other CA']).toBe('Other CA')
    expect(REGION_DISPLAY_NAMES['Rest of US']).toBe('Rest of US')
    expect(REGION_DISPLAY_NAMES['International']).toBe('International')
  })
})

describe('aggregateCityCountsByRegion', () => {
  it('should group cities by region and sum counts', () => {
    const byCity: CityBreakdown[] = [
      { city: 'Oakland', count: 30, percentage: 30 },
      { city: 'Berkeley', count: 20, percentage: 20 },
      { city: 'San Francisco', count: 40, percentage: 40 },
      { city: 'Denver', count: 10, percentage: 10 },
    ]

    const result = aggregateCityCountsByRegion(byCity)

    // SF: 40, East Bay: 50, Rest of US: 10
    const sfRegion = result.find((r) => r.region === 'sf')
    const eastBay = result.find((r) => r.region === 'eastBay')
    const restOfUs = result.find((r) => r.region === 'Rest of US')

    expect(sfRegion?.count).toBe(40)
    expect(eastBay?.count).toBe(50)
    expect(restOfUs?.count).toBe(10)
  })

  it('should recompute percentages based on total', () => {
    const byCity: CityBreakdown[] = [
      { city: 'Oakland', count: 50, percentage: 50 },
      { city: 'San Francisco', count: 50, percentage: 50 },
    ]

    const result = aggregateCityCountsByRegion(byCity)

    const sfRegion = result.find((r) => r.region === 'sf')
    const eastBay = result.find((r) => r.region === 'eastBay')

    expect(sfRegion?.percentage).toBe(50)
    expect(eastBay?.percentage).toBe(50)
  })

  it('should sort by count descending', () => {
    const byCity: CityBreakdown[] = [
      { city: 'Denver', count: 5, percentage: 5 },
      { city: 'Oakland', count: 50, percentage: 50 },
      { city: 'San Francisco', count: 30, percentage: 30 },
      { city: 'Los Angeles', count: 15, percentage: 15 },
    ]

    const result = aggregateCityCountsByRegion(byCity)

    expect(result[0]!.region).toBe('eastBay')
    expect(result[1]!.region).toBe('sf')
    expect(result[2]!.region).toBe('Other CA')
    expect(result[3]!.region).toBe('Rest of US')
  })

  it('should handle empty input', () => {
    expect(aggregateCityCountsByRegion([])).toEqual([])
  })
})

describe('aggregateCityRetentionByRegion', () => {
  it('should aggregate base_count and returned_count by region', () => {
    const byCity: RetentionByCity[] = [
      { city: 'Oakland', base_count: 20, returned_count: 15, retention_rate: 0.75 },
      { city: 'Berkeley', base_count: 10, returned_count: 8, retention_rate: 0.8 },
      { city: 'San Francisco', base_count: 30, returned_count: 20, retention_rate: 0.667 },
    ]

    const result = aggregateCityRetentionByRegion(byCity)

    const eastBay = result.find((r) => r.region === 'eastBay')
    expect(eastBay?.base_count).toBe(30)
    expect(eastBay?.returned_count).toBe(23)

    const sf = result.find((r) => r.region === 'sf')
    expect(sf?.base_count).toBe(30)
    expect(sf?.returned_count).toBe(20)
  })

  it('should recompute retention_rate from aggregated counts', () => {
    const byCity: RetentionByCity[] = [
      { city: 'Oakland', base_count: 20, returned_count: 10, retention_rate: 0.5 },
      { city: 'Berkeley', base_count: 30, returned_count: 20, retention_rate: 0.667 },
    ]

    const result = aggregateCityRetentionByRegion(byCity)

    const eastBay = result.find((r) => r.region === 'eastBay')
    // 30 returned out of 50 base = 0.6
    expect(eastBay?.retention_rate).toBe(30 / 50)
  })

  it('should handle empty input', () => {
    expect(aggregateCityRetentionByRegion([])).toEqual([])
  })
})

describe('aggregateCityEnrollmentByRegion', () => {
  it('should aggregate counts by region', () => {
    const byCity = [
      { city: 'Oakland', count: 25 },
      { city: 'Berkeley', count: 15 },
      { city: 'San Francisco', count: 40 },
    ]

    const result = aggregateCityEnrollmentByRegion(byCity)

    const eastBay = result.find((r) => r.region === 'eastBay')
    const sf = result.find((r) => r.region === 'sf')

    expect(eastBay?.count).toBe(40)
    expect(sf?.count).toBe(40)
  })

  it('should handle empty input', () => {
    expect(aggregateCityEnrollmentByRegion([])).toEqual([])
  })
})
