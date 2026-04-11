import { describe, it, expect } from 'vitest'
import { formatSyncDates } from './rawDataDates'

describe('formatSyncDates', () => {
  it('returns none when no updatedAt', () => {
    const result = formatSyncDates(undefined, undefined)
    expect(result.mode).toBe('none')
    expect(result.syncedDisplay).toBeNull()
    expect(result.processedDisplay).toBeNull()
  })

  it('returns synced-only when no processedAt', () => {
    const result = formatSyncDates('2026-04-07T10:00:00Z', undefined)
    expect(result.mode).toBe('synced-only')
    expect(result.syncedDisplay).toBeTruthy()
    expect(result.processedDisplay).toBeNull()
  })

  it('returns synced-only when processedAt is empty string', () => {
    const result = formatSyncDates('2026-04-07T10:00:00Z', '')
    expect(result.mode).toBe('synced-only')
  })

  it('returns same-day when both dates are same day', () => {
    const result = formatSyncDates('2026-04-07T15:00:00Z', '2026-04-07T18:00:00Z')
    expect(result.mode).toBe('same-day')
    expect(result.syncedDisplay).toBeTruthy()
    expect(result.processedDisplay).toBeTruthy()
  })

  it('returns different-days when dates differ', () => {
    const result = formatSyncDates('2026-04-05T10:00:00Z', '2026-04-07T18:00:00Z')
    expect(result.mode).toBe('different-days')
    expect(result.syncedDisplay).toBeTruthy()
    expect(result.processedDisplay).toBeTruthy()
    expect(result.syncedDisplay).not.toBe(result.processedDisplay)
  })
})
