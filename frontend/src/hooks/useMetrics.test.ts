/**
 * Tests for useMetrics hooks and MetricsFilterOptions type
 *
 * TDD: Tests for #567 (mutual exclusivity) and #562 (useComparisonMetrics options)
 * written before implementation.
 */
import { describe, it, expect, assertType } from 'vitest'
import type {
  MetricsFilterOptions,
  RegistrationFilterOptions,
  HistoricalFilterOptions,
} from './useMetrics'

describe('MetricsFilterOptions type (#567)', () => {
  it('should allow sessionCmId without duration', () => {
    const opts: MetricsFilterOptions = { sessionCmId: 1000 }
    assertType<MetricsFilterOptions>(opts)
    expect(opts.sessionCmId).toBe(1000)
  })

  it('should allow duration without sessionCmId', () => {
    const opts: MetricsFilterOptions = { duration: '2-week' }
    assertType<MetricsFilterOptions>(opts)
    expect(opts.duration).toBe('2-week')
  })

  it('should allow sessionTypes alone', () => {
    const opts: MetricsFilterOptions = { sessionTypes: 'main,embedded' }
    assertType<MetricsFilterOptions>(opts)
    expect(opts.sessionTypes).toBe('main,embedded')
  })

  it('should allow empty options', () => {
    const opts: MetricsFilterOptions = {}
    assertType<MetricsFilterOptions>(opts)
    expect(opts).toEqual({})
  })

  it('should allow sessionCmId with explicit undefined duration', () => {
    const opts: MetricsFilterOptions = { sessionCmId: 1000, duration: undefined }
    assertType<MetricsFilterOptions>(opts)
    expect(opts.sessionCmId).toBe(1000)
  })

  it('should allow duration with explicit undefined sessionCmId', () => {
    const opts: MetricsFilterOptions = { sessionCmId: undefined, duration: '1-week' }
    assertType<MetricsFilterOptions>(opts)
    expect(opts.duration).toBe('1-week')
  })

  it('should reject both sessionCmId and duration set simultaneously', () => {
    // Validated at compile time: if the @ts-expect-error becomes unnecessary,
    // tsc errors, meaning the type stopped enforcing mutual exclusivity.
    // `assertType` rather than an unused `_opts` binding so the probe has no
    // dead variable to explain away.
    // @ts-expect-error - sessionCmId and duration are mutually exclusive
    assertType<MetricsFilterOptions>({ sessionCmId: 1000, duration: '2-week' })
    expect(true).toBe(true)
  })
})

describe('RegistrationFilterOptions', () => {
  it('should extend MetricsFilterOptions with statuses', () => {
    const opts: RegistrationFilterOptions = { sessionTypes: 'main', statuses: 'enrolled' }
    assertType<RegistrationFilterOptions>(opts)
    expect(opts.statuses).toBe('enrolled')
  })

  it('should still enforce mutual exclusivity', () => {
    // @ts-expect-error - sessionCmId and duration are mutually exclusive
    assertType<RegistrationFilterOptions>({
      sessionCmId: 1000,
      duration: '2-week',
      statuses: 'enrolled',
    })
    expect(true).toBe(true)
  })
})

describe('HistoricalFilterOptions', () => {
  it('should extend MetricsFilterOptions with years', () => {
    const opts: HistoricalFilterOptions = { years: '2023,2024,2025' }
    assertType<HistoricalFilterOptions>(opts)
    expect(opts.years).toBe('2023,2024,2025')
  })

  it('should still enforce mutual exclusivity', () => {
    // @ts-expect-error - sessionCmId and duration are mutually exclusive
    assertType<HistoricalFilterOptions>({
      sessionCmId: 1000,
      duration: '2-week',
      years: '2023,2024',
    })
    expect(true).toBe(true)
  })
})

describe('metricsFilter helper', () => {
  it('should be exported from useMetrics', async () => {
    const module = await import('./useMetrics')
    expect(typeof module.metricsFilter).toBe('function')
  })

  it('should return sessionCmId filter when sessionCmId is provided', async () => {
    const { metricsFilter } = await import('./useMetrics')
    const result = metricsFilter({
      sessionTypes: 'main',
      sessionCmId: 1000,
    })
    expect(result).toEqual({ sessionTypes: 'main', sessionCmId: 1000 })
  })

  it('should return duration filter when duration is provided', async () => {
    const { metricsFilter } = await import('./useMetrics')
    const result = metricsFilter({
      sessionTypes: 'main',
      duration: '2-week',
    })
    expect(result).toEqual({ sessionTypes: 'main', duration: '2-week' })
  })

  it('should return base filter when neither is provided', async () => {
    const { metricsFilter } = await import('./useMetrics')
    const result = metricsFilter({
      sessionTypes: 'main',
    })
    expect(result).toEqual({ sessionTypes: 'main' })
  })

  it('should handle null sessionCmId as absent', async () => {
    const { metricsFilter } = await import('./useMetrics')
    const result = metricsFilter({
      sessionTypes: 'main',
      sessionCmId: null,
      duration: '1-week',
    })
    expect(result).toEqual({ sessionTypes: 'main', duration: '1-week' })
  })

  it('should handle null duration as absent', async () => {
    const { metricsFilter } = await import('./useMetrics')
    const result = metricsFilter({
      sessionTypes: 'main',
      sessionCmId: 1000,
      duration: null,
    })
    expect(result).toEqual({ sessionTypes: 'main', sessionCmId: 1000 })
  })

  it('should handle undefined values as absent', async () => {
    const { metricsFilter } = await import('./useMetrics')
    const result = metricsFilter({
      sessionTypes: 'main',
      sessionCmId: undefined,
      duration: undefined,
    })
    expect(result).toEqual({ sessionTypes: 'main' })
  })

  it('should prioritize sessionCmId over duration when both are non-null', async () => {
    // This shouldn't happen in practice (UI prevents it), but the helper
    // should deterministically pick one rather than sending both
    const { metricsFilter } = await import('./useMetrics')
    const result = metricsFilter({
      sessionCmId: 1000,
      duration: '2-week',
    })
    expect(result.sessionCmId).toBe(1000)
    expect(result).not.toHaveProperty('duration')
  })
})

describe('useComparisonMetrics options (#562)', () => {
  it('should include filter params in comparison query key', async () => {
    const { queryKeys } = await import('../utils/queryKeys')
    const key = queryKeys.comparison(2025, 2026)
    const keyWithTypes = queryKeys.comparison(2025, 2026, 'main,embedded')

    // Without options, key should be base
    expect(key).toEqual(['metrics', 'comparison', 2025, 2026, undefined, undefined, undefined])
    // With sessionTypes, key should include it
    expect(keyWithTypes).toEqual([
      'metrics',
      'comparison',
      2025,
      2026,
      'main,embedded',
      undefined,
      undefined,
    ])
  })
})
